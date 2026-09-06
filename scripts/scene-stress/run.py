"""Launch and sample only the stress binary's process tree. Linux + GTK3/GDK-X11."""
import argparse
import csv
import json
import os
import pathlib
import re
import subprocess
import time
import sys

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=pathlib.Path)
parser.add_argument('--quick', action='store_true')
parser.add_argument('--foreground', action='store_true', help='Keep the owned test window focused during animation stages')
parser.add_argument('--name', default='full')
args = parser.parse_args()
bundle = args.directory.resolve()
output = bundle / args.name
output.mkdir(parents=True, exist_ok=True)
app_data = output / 'data' / 'com.shiyin.music'
app_data.mkdir(parents=True, exist_ok=True)
settings = app_data / 'settings.json'
if settings.exists():
    raise SystemExit('Use a new --name for a fresh isolated run.')
settings.write_text(json.dumps({'stress.plan': {'enabled': True, 'quick': args.quick}, 'volume': 0, 'theme': 'dark'}))

def command(parts):
    try:
        return subprocess.check_output(parts, stderr=subprocess.DEVNULL, text=True, timeout=5).strip()
    except (OSError, subprocess.SubprocessError):
        return None

metadata = {
    'commit': command(['git', 'rev-parse', 'HEAD']),
    'kernel': command(['uname', '-r']),
    'cpu': command(['lscpu', '-J']),
    'displays': command(['xrandr', '--current']),
    'ram': pathlib.Path('/proc/meminfo').read_text().splitlines()[0],
    'startUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'quick': args.quick,
    'foregroundRequested': args.foreground,
}
clock_ticks = os.sysconf('SC_CLK_TCK')
page_size = os.sysconf('SC_PAGE_SIZE')

def processes(root):
    rows = {}
    for entry in pathlib.Path('/proc').glob('[0-9]*/stat'):
        try:
            raw = entry.read_text(); fields = raw[raw.rfind(')') + 2:].split()
            rows[int(entry.parent.name)] = {'ppid': int(fields[1]), 'cpuSeconds': (int(fields[11]) + int(fields[12])) / clock_ticks,
                'rssBytes': int(fields[21]) * page_size, 'start': int(fields[19])}
        except (OSError, ValueError, IndexError):
            pass
    owned = {root}
    for _ in range(8):
        owned.update(pid for pid, values in rows.items() if values['ppid'] in owned)
    result = {}
    for pid in owned:
        if pid not in rows:
            continue
        values = rows[pid]
        try:
            values['name'] = pathlib.Path(f'/proc/{pid}/comm').read_text().strip()
        except OSError:
            continue
        try:
            rollup = pathlib.Path(f'/proc/{pid}/smaps_rollup').read_text()
            values['pssBytes'] = int(re.search(r'^Pss:\s+(\d+)', rollup, re.M)[1]) * 1024
        except (OSError, TypeError):
            values['pssBytes'] = None
        devices, drm = set(), {}
        try:
            for descriptor in pathlib.Path(f'/proc/{pid}/fd').iterdir():
                try:
                    target = os.readlink(descriptor)
                    if not target.startswith(('/dev/dri/', '/dev/nvidia')):
                        continue
                    devices.add(target)
                    fields = dict(line.split(':', 1) for line in pathlib.Path(f'/proc/{pid}/fdinfo/{descriptor.name}').read_text().splitlines() if ':' in line)
                    fields = {key: value.strip() for key, value in fields.items() if key.startswith('drm-')}
                    if fields:
                        drm[fields.get('drm-client-id', descriptor.name)] = fields
                except OSError:
                    pass
        except OSError:
            pass
        values['gpuDevices'] = sorted(devices); values['drm'] = list(drm.values())
        result[pid] = values
    return result

def gpu_sample(owned):
    raw = command(['nvidia-smi', '--query-gpu=name,driver_version,utilization.gpu,memory.used,power.draw,temperature.gpu', '--format=csv,noheader,nounits'])
    global_gpu = list(csv.reader(raw.splitlines())) if raw else []
    pmon = command(['nvidia-smi', 'pmon', '-c', '1', '-s', 'um'])
    values = []
    for line in (pmon or '').splitlines():
        row = line.split()
        if not row or row[0].startswith('#') or len(row) < 12:
            continue
        if row[1].isdigit() and int(row[1]) in owned:
            values.append(dict(zip(['gpu', 'pid', 'type', 'smPercent', 'memoryBandwidthPercent', 'encoder', 'decoder', 'jpeg', 'ofa', 'framebufferMiB', 'ccpmMiB'], row[:11])))
    return {'global': global_gpu, 'owned': values}

def activate_owned_window(pid):
    # Keep window-system calls outside the sampler so they cannot block telemetry.
    try:
        subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name('activate.py')), str(pid)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2, check=True)
        return True
    except (OSError, subprocess.SubprocessError):
        return False

samples, events = [], []
phase = 'startup'
started = time.monotonic()
log_path = output / 'native.log'
log_offset = 0
outcome = None
last_print = 0
last_activation = 0
try:
    with log_path.open('w') as log_file:
        env = dict(os.environ, XDG_DATA_HOME=str(output / 'data'), XDG_CACHE_HOME=str(output / 'cache'))
        process = subprocess.Popen([str(bundle / 'scene-stress')], env=env, stdout=log_file, stderr=subprocess.STDOUT)
        metadata['rootPid'] = process.pid
        while process.poll() is None and time.monotonic() - started < (180 if args.quick else 780):
            tick = time.monotonic()
            with log_path.open() as current_log:
                current_log.seek(log_offset)
                for line in current_log:
                    if 'SCENE_STRESS ' not in line:
                        continue
                    raw = line.split('SCENE_STRESS ', 1)[1]
                    try:
                        event = json.JSONDecoder().raw_decode(raw)[0]
                    except json.JSONDecodeError:
                        continue
                    event['observedSeconds'] = time.monotonic() - started; events.append(event)
                    if event['kind'] == 'phase':
                        phase = event['name']; print(f"{event['observedSeconds']:.1f}s {phase}", flush=True)
                    if event['kind'] == 'activate':
                        activate_owned_window(process.pid)
                    if event['kind'] in ('done', 'failed'):
                        outcome = event
                log_offset = current_log.tell()
            owned = processes(process.pid)
            if args.foreground and phase.startswith(('warmup.', 'immersive.', 'main.', 'switches.', 'library.')) and time.monotonic() - last_activation >= 4:
                activate_owned_window(process.pid); last_activation = time.monotonic()
            samples.append({'seconds': time.monotonic() - started, 'phase': phase, 'processes': owned, 'gpu': gpu_sample(owned)})
            memory = sum(item.get('pssBytes') or item['rssBytes'] for item in owned.values())
            if memory > 3 * 1024**3:
                outcome = {'kind': 'failed', 'error': 'Owned PSS exceeded the 3 GiB test budget'}
            if outcome:
                break
            if time.monotonic() - last_print > 25:
                last_print = time.monotonic()
                print(f"sampling {phase}: {sum(x['rssBytes'] for x in owned.values()) / 1024**2:.0f} MiB RSS", flush=True)
            time.sleep(max(0, 1 - (time.monotonic() - tick)))
        if outcome is None:
            outcome = {'kind': 'failed', 'error': 'Test process exited or exceeded timeout'}
finally:
    if 'process' in globals() and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
    result = {'metadata': metadata, 'outcome': outcome, 'events': events, 'samples': samples}
    (output / 'report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(outcome, ensure_ascii=False), flush=True)
