"""Aggregate native stress telemetry. CPU percentages use one logical CPU as 100%."""
import argparse
import json
import math
import pathlib
import statistics

parser = argparse.ArgumentParser()
parser.add_argument('report', type=pathlib.Path)
args = parser.parse_args()
report = json.loads(args.report.read_text())

def stats(values):
    values = sorted(value for value in values if value is not None and math.isfinite(value))
    if not values:
        return None
    return {'mean': statistics.mean(values), 'p95': values[min(len(values)-1, int(len(values)*.95))], 'min': values[0], 'max': values[-1], 'count': len(values)}

phases = {}
for previous, current in zip(report['samples'], report['samples'][1:]):
    if previous['phase'] != current['phase']:
        continue  # Boundary samples mix workloads; retain steady intervals only.
    elapsed = current['seconds'] - previous['seconds']
    if elapsed <= 0:
        continue
    cpu = 0
    for pid, process in current['processes'].items():
        earlier = previous['processes'].get(pid)
        baseline = earlier['cpuSeconds'] if earlier and earlier['start'] == process['start'] else 0
        cpu += max(0, process['cpuSeconds'] - baseline)
    row = phases.setdefault(current['phase'], {'cpu': [], 'rss': [], 'pss': [], 'gpuFb': [], 'gpuSm': [], 'globalGpu': [], 'globalPower': []})
    row['cpu'].append(cpu / elapsed * 100)
    row['rss'].append(sum(item['rssBytes'] for item in current['processes'].values()) / 1024**2)
    pss = [item['pssBytes'] for item in current['processes'].values()]
    row['pss'].append(sum(pss) / 1024**2 if all(value is not None for value in pss) else None)
    owned = current['gpu']['owned']
    row['gpuFb'].append(sum(float(item['framebufferMiB']) for item in owned if item['framebufferMiB'] != '-') if owned else None)
    sm = [float(item['smPercent']) for item in owned if item['smPercent'] != '-']
    row['gpuSm'].append(sum(sm) if sm else None)
    for device in current['gpu']['global']:
        try:
            row['globalGpu'].append(float(device[2]));row['globalPower'].append(float(device[4]))
        except (ValueError, IndexError):
            pass

resources = {name: {metric: stats(values) for metric, values in row.items()} for name, row in phases.items()}
results = []
for event in report['events']:
    if event['kind'] != 'result':
        continue
    samples = event['visibility']
    results.append({
        'name': event['name'], 'seconds': event['elapsedMs']/1000, 'viewport': event['viewport'],
        'rafP95Ms': event['raf']['p95'], 'rafP99Ms': event['raf']['p99'], 'rafMaxMs': event['raf']['max'],
        'drawFps': event['drawFps'], 'draws': event['draws'], 'drawCallbackP95Ms': event['drawCallback']['p95'],
        'interactionP95Ms': event['interaction']['p95'], 'quality': event['quality'],
        'visibleRatio': sum(value['visible'] for value in samples)/len(samples) if samples else None,
        'focusedRatio': sum(value['focused'] for value in samples)/len(samples) if samples else None,
        'signalFreshRatio': sum(value['signalFresh'] for value in samples)/len(samples) if samples else None,
        'resources': resources.get(event['name']),
    })
summary = {'commit': report['metadata']['commit'], 'outcome': report['outcome'], 'results': results,
    'resources': resources, 'imports': [event for event in report['events'] if event['kind']=='import']}
args.report.with_name('summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
for result in results:
    r = result['resources'] or {}
    def average(name):
        return round(r[name]['mean'], 1) if r.get(name) else None
    print(result['name'], f"RAF P95={result['rafP95Ms']}ms, draw={result['drawFps']:.1f}/s, CPU={average('cpu')}%, PSS={average('pss')}MiB, GPU fb={average('gpuFb')}MiB")
