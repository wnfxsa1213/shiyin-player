import { isPlayerWindowVisible, onPlayerWindowChanged } from '@/lib/ipc';
import { usePlayerStore } from '@/store/playerStore';
import { useSceneStore } from '@/store/sceneStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { spectrumDataRef } from '@/store/visualizerStore';
import { useToastStore } from '@/store/toastStore';
import { SCENE_PRESETS } from './model';
import { createSceneBag, createSceneRotation } from './rotation';
import { hasVisualPlayback } from './spectrum';

const bag = createSceneBag();
export async function nextScene(manual = false, canCommit = () => true): Promise<boolean> {
  const state = useSceneStore.getState();
  if (!state.ready || state.applying) return false;
  const id = bag.next(state.rotationIds, state.current.id);
  const scene = [...SCENE_PRESETS, ...state.saved].find(item => item.id === id);
  if (!scene) {
    if (manual) useToastStore.getState().addToast('info', '请在轮换中加入其他场景');
    return false;
  }
  return state.apply(scene, canCommit);
}

/** One app-level scheduler; views only set whether the scene editor is open. */
export function startSceneRuntime() {
  let alive = true, dragging = false, nativeVisible = true, querying = false, queryAgain = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let visibilityTimer: ReturnType<typeof setTimeout> | undefined;
  let nativeCleanup: (() => void) | undefined;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const rotation = createSceneRotation({ now: () => performance.now(), rotate: guard => nextScene(false, guard) });
  function clearSpectrum() {
    spectrumDataRef.current.fill(0); spectrumDataRef.receivedAt = 0; spectrumDataRef.playbackId = null;
  }
  function update() {
    const player = usePlayerStore.getState(), scene = useSceneStore.getState(), environment = useSceneEnvironment.getState();
    const playing = hasVisualPlayback(player);
    const focused = document.activeElement;
    const editing = focused instanceof HTMLElement && !!focused.closest('input, select, textarea, [contenteditable="true"]');
    rotation.update({
      playing: playing && scene.ready, visible: environment.visible, locked: scene.locked, scene: scene.current,
      sessionId: player.listening.sessionId,
      blocked: environment.editorOpen || dragging || editing || !!document.querySelector('[role="menu"], [data-scene-block]'),
    });
    if (!playing || !environment.visible || spectrumDataRef.playbackId !== player.listening.playbackId) clearSpectrum();
    const ticking = playing && environment.visible;
    if (ticking && !timer) timer = setInterval(() => { update(); void checkNativeVisibility(); }, 1000);
    else if (!ticking && timer) { clearInterval(timer); timer = undefined; }
  }
  function updateEnvironment() {
    const visible = document.visibilityState !== 'hidden' && nativeVisible;
    const state = useSceneEnvironment.getState();
    if (state.visible !== visible || state.reducedMotion !== motion.matches) useSceneEnvironment.setState({ visible, reducedMotion: motion.matches });
    update();
  }
  async function checkNativeVisibility() {
    if (!alive) return;
    if (querying) { queryAgain = true; return; }
    querying = true;
    try { const visible = await isPlayerWindowVisible(); if (alive) { nativeVisible = visible; updateEnvironment(); } }
    catch { /* Browser development uses Page Visibility; native capability may be unavailable. */ }
    finally { querying = false; if (queryAgain) { queryAgain = false; void checkNativeVisibility(); } }
  }
  const interact = () => { rotation.interact(); update(); };
  const down = () => { dragging = true; interact(); };
  const up = () => { dragging = false; interact(); };
  const onVisibility = () => {
    updateEnvironment(); void checkNativeVisibility();
    // GTK focus/resize notifications can precede the native minimized-state update.
    // Recheck once after the transition; this is bounded and also works with the playback timer stopped.
    clearTimeout(visibilityTimer);
    visibilityTimer = setTimeout(() => { void checkNativeVisibility(); }, 150);
  };
  const subscriptions = [usePlayerStore.subscribe(update), useSceneStore.subscribe(update), useSceneEnvironment.subscribe(update)];
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', up);
  window.addEventListener('keydown', interact, true);
  window.addEventListener('wheel', interact, { capture: true, passive: true });
  window.addEventListener('focus', onVisibility);
  document.addEventListener('visibilitychange', onVisibility);
  motion.addEventListener('change', updateEnvironment);
  void onPlayerWindowChanged(onVisibility).then(cleanup => { if (alive) nativeCleanup = cleanup; else cleanup(); }).catch(() => {});
  updateEnvironment(); void checkNativeVisibility();
  void useSceneStore.getState().initialize();
  return () => {
    alive = false; rotation.dispose(); clearInterval(timer); clearTimeout(visibilityTimer); nativeCleanup?.(); subscriptions.forEach(unsubscribe => unsubscribe());
    window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true); window.removeEventListener('blur', up);
    window.removeEventListener('keydown', interact, true); window.removeEventListener('wheel', interact, true);
    window.removeEventListener('focus', onVisibility); document.removeEventListener('visibilitychange', onVisibility);
    motion.removeEventListener('change', updateEnvironment); clearSpectrum();
  };
}
