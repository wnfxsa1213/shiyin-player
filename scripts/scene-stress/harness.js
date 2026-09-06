// Test-only entry: real App, native asset/settings IPC and Tauri events; synthetic music/discovery data.
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import { ipc } from '@/lib/ipc';
import { loadSetting } from '@/lib/settings';
import { useSceneStore } from '@/store/sceneStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { usePlayerStore } from '@/store/playerStore';
import { useUiStore } from '@/store/uiStore';
import { spectrumDataRef } from '@/store/visualizerStore';
import { SCENE_PRESETS, cloneScene } from '@/lib/scenes/model';

const plan = await loadSetting('stress.plan') || {};
if (plan.enabled !== true) {
  document.getElementById('root').textContent = '压力测试请通过 scripts/scene-stress/run.py 启动，以使用独立数据目录。';
  throw new Error('Missing isolated stress-test marker');
}
const quick = plan.quick === true;
const report = { kind: 'start', quick, results: [], checks: [], errors: [], changes: [], runtime: navigator.userAgent };
const log = data => ipc.clientLog('info', `SCENE_STRESS ${JSON.stringify(data)}`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const $ = selector => document.querySelector(selector);
const until = async (predicate, timeout = 10000) => {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) { if (await predicate()) return; await delay(40); }
  throw new Error(`Timed out: ${predicate}`);
};
function check(name, pass, detail) {
  report.checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) throw new Error(`${name}: ${JSON.stringify(detail)}`);
}
const win = getCurrentWindow();
const originalRAF = window.requestAnimationFrame.bind(window);
const cancelRAF = window.cancelAnimationFrame.bind(window);
const originalClear = CanvasRenderingContext2D.prototype.clearRect;
let totalDraws = 0, totalCallbacks = 0, recording = false, phase = 'setup';
let gaps = [], drawTimes = [], callbackTimes = [], quality = {}, visibility = [], interactions = [];
let probe, lastProbe;
window.requestAnimationFrame = callback => originalRAF(time => {
  const before = totalDraws, start = performance.now();
  callback(time); totalCallbacks++;
  if (recording) {
    const cost = performance.now() - start; callbackTimes.push(cost);
    if (totalDraws > before) drawTimes.push(cost);
  }
});
CanvasRenderingContext2D.prototype.clearRect = function (...args) {
  if (this.canvas.classList.contains('scene-canvas')) totalDraws++;
  return originalClear.apply(this, args);
};
const sampleFrames = time => {
  if (recording && lastProbe !== undefined) gaps.push(time - lastProbe);
  lastProbe = time; probe = window.requestAnimationFrame(sampleFrames);
};
const quantile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] : null;
const numbers = values => ({ samples: values.length, p50: quantile(values, .5), p95: quantile(values, .95), p99: quantile(values, .99), max: values.length ? Math.max(...values) : null });
let playing = false, signalTimer, progressTimer, position = 0;
const track = { id: 'scene-stress-only', name: '场景压力测试', artist: '合成频谱 · 不播放声音', album: '测试数据', source: 'netease', durationMs: 900_000 };
function playback(value) {
  playing = value;
  usePlayerStore.setState({ currentTrack: track, playbackId: 901, state: value ? 'playing' : 'paused', playWhenReady: value,
    positionMs: position, durationMs: track.durationMs, emittedAtMs: Date.now(), listening: { sessionId: 901, playbackId: 901, state: value ? 'playing' : 'paused', track } });
}
// These substitutes avoid account/network variability. Asset and setting methods remain native.
ipc.checkLoginStatus = async () => ({ netease: false, qqmusic: false });
ipc.getUserPlaylists = async () => [];
ipc.getLyrics = async () => Array.from({ length: 1500 }, (_, index) => ({ time_ms: index * 600, text: `第 ${index + 1} 行 · 音乐与光影一起流动`, translation: null }));
window.addEventListener('error', event => { report.errors.push(event.message); });
window.addEventListener('unhandledrejection', event => { report.errors.push(String(event.reason)); });
useUiStore.subscribe((state, previous) => { if (state.immersiveOpen !== previous.immersiveOpen) report.changes.push({ phase, kind: 'immersive', value: state.immersiveOpen }); });
useSceneEnvironment.subscribe((state, previous) => { if (state.visible !== previous.visible) report.changes.push({ phase, kind: 'visible', value: state.visible }); });

await import('@/main');
await until(() => useSceneStore.getState().ready && $('a[href="/scenes"]'));
useSceneStore.getState().setLocked(true);
usePlayerStore.setState({ seek: async (value, expectedId) => { if (expectedId != null && expectedId !== 901) return; position = value; usePlayerStore.setState({ positionMs: value, emittedAtMs: Date.now() }); } });
const observerTimer = setInterval(() => {
  if (!recording) return;
  const canvas = $('canvas[data-running="true"]');
  const tier = canvas?.dataset.quality || 'none'; quality[tier] = (quality[tier] || 0) + 1;
  visibility.push({ visible: useSceneEnvironment.getState().visible, focused: document.hasFocus(), signalFresh: performance.now() - spectrumDataRef.receivedAt < 350 && spectrumDataRef.current[0] > .5 });
}, 1000);
const statusTimer = setInterval(() => { void log({ kind: 'heartbeat', phase, visible: useSceneEnvironment.getState().visible, viewport: [innerWidth, innerHeight], running: document.querySelectorAll('canvas[data-running="true"]').length }); }, 8000);

async function phaseStart(name, animation = true) {
  phase = name; recording = false; if (probe !== undefined) cancelRAF(probe); probe = lastProbe = undefined;
  gaps = []; drawTimes = []; callbackTimes = []; quality = {}; visibility = []; interactions = [];
  await log({ kind: 'phase', name, time: performance.now(), viewport: [innerWidth, innerHeight] });
  if (animation) probe = window.requestAnimationFrame(sampleFrames);
}
async function sample(name, duration, { animated = true, workload } = {}) {
  await phaseStart(name, animated);
  const before = { time: performance.now(), draws: totalDraws, callbacks: totalCallbacks };
  recording = true;
  await (workload ? workload() : delay(duration));
  recording = false;
  const elapsed = performance.now() - before.time;
  if (probe !== undefined) cancelRAF(probe); probe = lastProbe = undefined;
  const canvases = [...document.querySelectorAll('canvas.scene-canvas')].map(canvas => ({ width: canvas.width, height: canvas.height, running: canvas.dataset.running === 'true', tier: canvas.dataset.quality }));
  const result = { name, elapsedMs: elapsed, viewport: [innerWidth, innerHeight], raf: numbers(gaps), drawCallback: numbers(drawTimes), callback: numbers(callbackTimes), draws: totalDraws - before.draws, callbacks: totalCallbacks - before.callbacks,
    drawFps: (totalDraws - before.draws) / elapsed * 1000, interaction: numbers(interactions), quality, visibility, canvases };
  report.results.push(result); await log({ kind: 'result', ...result });
  return result;
}
async function resize(width, height) {
  await win.setPosition(new LogicalPosition(0, 60)); await win.setSize(new LogicalSize(width, height)); await delay(1000);
  await log({ kind: 'viewport', requested: [width, height], actual: [innerWidth, innerHeight], dpr: devicePixelRatio });
}
async function focusWindow() {
  await win.show(); await win.unminimize(); await delay(250); await win.setFocus();
  await log({ kind: 'activate' });
  await until(() => useSceneEnvironment.getState().visible);
}
async function lockInteraction() {
  const button = $('[aria-label="沉浸式播放"] .scene-rotation button');
  if (!button) throw new Error('Immersive scene unexpectedly closed');
  const start = performance.now(); button.click(); await new Promise(resolve => window.requestAnimationFrame(resolve));
  interactions.push(performance.now() - start);
  useSceneStore.getState().setLocked(true);
}
async function fixtureFile(index) {
  const response = await fetch(`fixture-${index}.png`); if (!response.ok) throw new Error('Missing image fixture');
  return new File([await response.blob()], `stress-${index}.png`, { type: 'image/png' });
}

try {
  const webglCanvas = document.createElement('canvas');
  const gl = webglCanvas.getContext('webgl');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  report.graphics = gl ? { vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION) } : null;
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  await log({ kind: 'start', quick, runtime: report.runtime, graphics: report.graphics });
  await focusWindow(); await delay(2000);
  await sample('idle.initial', quick ? 1000 : 10000, { animated: false });
  const fixtures = await Promise.all([0, 1, 2].map(fixtureFile));
  const assets = [];
  await sample('images.import', 0, { workload: async () => {
    for (const file of fixtures) {
      const start = performance.now(); const asset = await useSceneStore.getState().importBackground(file);
      check('image imported', asset != null); assets.push(asset);
      await log({ kind: 'import', bytes: file.size, elapsedMs: performance.now() - start, asset });
    }
    const duplicate = await useSceneStore.getState().importBackground(fixtures[0]);
    check('dedupe under load', duplicate.id === assets[0].id && useSceneStore.getState().assets.length === 3);
  } });
  for (let index = 0; index < (quick ? 8 : 100); index++) useSceneStore.getState().saveAs({ ...cloneScene(SCENE_PRESETS[index % 8]), background: { kind: 'image', assetId: assets[index % 3].id } }, `压力搭配 ${index + 1}`);
  await useSceneStore.getState().flush();
  check('saved collection bounded', useSceneStore.getState().saved.length === (quick ? 8 : 100));
  playback(true);
  signalTimer = setInterval(() => {
    if (!playing || !useSceneEnvironment.getState().visible) return;
    const t = performance.now() / 1000;
    const value = .65 + .35 * Math.sin(t * 5) ** 2;
    void emitTo('main', 'player://spectrum', { playbackId: 901, emittedAtMs: Date.now(), magnitudes: Array(64).fill(value) });
  }, 67);
  progressTimer = setInterval(() => { if (playing) { position = (position + 200) % track.durationMs; usePlayerStore.setState({ positionMs: position, emittedAtMs: Date.now() }); } }, 200);
  usePlayerStore.setState({ queue: Array.from({ length: quick ? 100 : 5000 }, (_, index) => ({ ...track, id: `list-${index}`, name: `压力测试曲目 ${index + 1}` })), queueIndex: 0 });
  $('button[aria-label="播放队列"]').click(); await delay(300);
  await sample('main.queue-scroll', 0, { workload: async () => {
    const scroller = $('[aria-label="播放队列"] [class*="overflow-y-auto"]');
    check('queue scroller present', Boolean(scroller));
    const end = performance.now() + (quick ? 1500 : 18000);
    while (performance.now() < end) { scroller.scrollTop = (scroller.scrollTop + 180) % Math.max(1, scroller.scrollHeight - scroller.clientHeight); await delay(50); }
  } });
  useUiStore.getState().setImmersiveOpen(true); await resize(1920, 1080);
  await until(() => $('[aria-label="沉浸式播放"] canvas[data-running="true"]'));
  await until(() => spectrumDataRef.receivedAt > 0);
  check('native spectrum feeds renderer', spectrumDataRef.current[0] > .5);
  for (const scene of quick ? [SCENE_PRESETS[0], SCENE_PRESETS[3]] : SCENE_PRESETS) {
    await phaseStart(`warmup.${scene.effect}`); await useSceneStore.getState().apply(scene); await delay(quick ? 1200 : 17000);
    const duration = quick ? 1500 : 8000;
    const result = await sample(`immersive.${scene.effect}`, 0, { workload: async () => {
      const end = performance.now() + duration;
      while (performance.now() < end) { await lockInteraction(); await delay(900); }
    } });
    check('visible scene draws', result.draws > 0 && result.canvases.filter(canvas => canvas.running).length === 1, scene.effect);
    check('canvas pixel budget', result.canvases.every(canvas => canvas.width * canvas.height <= 1_605_000));
  }
  await resize(2560, 1440);
  await useSceneStore.getState().apply({ ...cloneScene(SCENE_PRESETS[3]), background: { kind: 'image', assetId: assets[0].id } });
  await phaseStart('warmup.large-image'); await delay(quick ? 1000 : 17000);
  await sample('immersive.large-image', quick ? 1500 : 12000);
  const switching = useSceneStore.getState().saved;
  for (let round = 1; round <= (quick ? 1 : 3); round++) {
    playback(true);
    await sample(`switches.${round}`, 0, { workload: async () => {
      for (let index = 0; index < (quick ? 8 : 80); index++) {
        check('scene applied during churn', await useSceneStore.getState().apply(switching[index % switching.length]));
        await delay(quick ? 80 : 250);
      }
    } });
    playback(false); await delay(800);
    const paused = await sample(`settled.${round}`, quick ? 1000 : 10000, { animated: false });
    check('paused churn leaves no loop', paused.draws === 0 && paused.canvases.every(canvas => !canvas.running));
  }
  await resize(1200, 800);useUiStore.getState().setImmersiveOpen(false);$('a[href="/scenes"]').click();await until(() => $('.scene-card'));
  await sample('library.preview-churn', 0, { workload: async () => {
    const cards = [...document.querySelectorAll('.scene-card')];
    for (let index = 0; index < (quick ? 12 : 100); index++) { cards[index % cards.length].click(); await delay(80); }
  } });
  useUiStore.getState().setImmersiveOpen(true);playback(true);await delay(500);
  for (let round = 0; round < (quick ? 1 : 3); round++) {
    await phaseStart('window.hide');await win.hide();await until(() => !useSceneEnvironment.getState().visible);
    await delay(300); const hidden = await sample(`hidden.${round}`, quick ? 700 : 1500, { animated: false });
    check('hidden window stops drawing', hidden.draws === 0);
    await focusWindow();await until(() => $('[aria-label="沉浸式播放"] canvas[data-running="true"]'));
  }
  playback(false); await delay(1000);
  const stopped = await sample('idle.final', quick ? 1000 : 15000, { animated: false });
  check('final stop releases animation', stopped.draws === 0 && stopped.canvases.every(canvas => !canvas.running));
  check('no frontend errors', report.errors.length === 0, report.errors);
  await useSceneStore.getState().flush();
  await log({ kind: 'done', checks: report.checks.length, errors: report.errors, changes: report.changes, graphics: report.graphics });
} catch (error) {
  await log({ kind: 'failed', phase, error: String(error), errors: report.errors, changes: report.changes });
} finally {
  recording = false; if (probe !== undefined) cancelRAF(probe);
  clearInterval(signalTimer);clearInterval(progressTimer);clearInterval(observerTimer);clearInterval(statusTimer);
  window.requestAnimationFrame = originalRAF;CanvasRenderingContext2D.prototype.clearRect = originalClear;
  window.sceneStressReport = report;
}
