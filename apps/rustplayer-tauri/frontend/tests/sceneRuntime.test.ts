// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startSceneRuntime } from '@/lib/scenes/runtime';
import { isPlayerWindowVisible } from '@/lib/ipc';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { usePlayerStore } from '@/store/playerStore';
import { spectrumDataRef } from '@/store/visualizerStore';
import { receiveSpectrum } from '@/lib/scenes/spectrum';

const native = vi.hoisted(() => ({ changed: null as (() => void) | null }));
vi.mock('@/lib/settings', () => ({ loadSetting: vi.fn().mockResolvedValue(null), saveSetting: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/ipc', () => ({
  isPlayerWindowVisible: vi.fn().mockResolvedValue(true),
  onPlayerWindowChanged: vi.fn(async (changed: () => void) => { native.changed = changed; return () => { native.changed = null; }; }),
  ipc: { listSceneBackgrounds: vi.fn().mockResolvedValue([]) },
}));
let stop: (() => void) | undefined;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  useSceneEnvironment.setState({ visible: true, reducedMotion: false, editorOpen: false });
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  vi.mocked(isPlayerWindowVisible).mockReset().mockResolvedValue(true);
});
afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('窗口恢复通知先于 GTK 状态变更时，停止中的运行时仍能恢复可见性', async () => {
  stop = startSceneRuntime(); await flush();
  vi.mocked(isPlayerWindowVisible).mockResolvedValue(false); native.changed?.(); await flush();
  expect(useSceneEnvironment.getState().visible).toBe(false);
  // Restore notification arrives while GTK still reports minimized.
  native.changed?.(); await flush();
  vi.mocked(isPlayerWindowVisible).mockResolvedValue(true);
  await vi.advanceTimersByTimeAsync(150);
  expect(useSceneEnvironment.getState().visible).toBe(true);
  expect(usePlayerStore.getState().state).toBe('idle');
});

it('查询尚未返回时到达的新窗口事件不会丢失，卸载不保留监听', async () => {
  let resolve!: (visible: boolean) => void;
  vi.mocked(isPlayerWindowVisible).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  stop = startSceneRuntime(); await flush(); native.changed?.();
  resolve(false); await flush();
  expect(useSceneEnvironment.getState().visible).toBe(true);
  stop(); stop = undefined; await vi.advanceTimersByTimeAsync(5000);
  expect(native.changed).toBeNull(); expect(isPlayerWindowVisible).toHaveBeenCalledTimes(2);
});

it('播放器暂停、加载和尝试切换立即清理频谱', async () => {
  stop = startSceneRuntime(); await flush();
  usePlayerStore.setState({ state: 'playing', playbackId: 1, listening: { sessionId: 1, playbackId: 1, state: 'playing', track: null } });
  spectrumDataRef.current.fill(.7); spectrumDataRef.playbackId = 1; spectrumDataRef.receivedAt = 123;
  usePlayerStore.setState({ state: 'buffering' });
  expect(spectrumDataRef.current[0]).toBe(0); expect(spectrumDataRef.receivedAt).toBe(0);
  usePlayerStore.setState({ state: 'playing' });
  spectrumDataRef.current.fill(.5); spectrumDataRef.playbackId = 1; spectrumDataRef.receivedAt = 456;
  usePlayerStore.setState({ listening: { sessionId: 2, playbackId: 2, state: 'playing', track: null } });
  expect(spectrumDataRef.current[0]).toBe(0); expect(spectrumDataRef.playbackId).toBeNull();
});

it('隐藏或开始新加载后，迟到频谱不能重新填充；恢复后只接受当前尝试的新信号', async () => {
  stop = startSceneRuntime(); await flush();
  const send = (playbackId = 1, emittedAtMs = Date.now()) => receiveSpectrum(
    { playbackId, emittedAtMs, magnitudes: [.7] }, usePlayerStore.getState(), useSceneEnvironment.getState().visible,
  );
  usePlayerStore.setState({ state: 'playing', playbackId: 1, listening: { sessionId: 1, playbackId: 1, state: 'playing', track: null } });
  send(); expect(spectrumDataRef.current[0]).toBeCloseTo(.7);
  useSceneEnvironment.setState({ visible: false }); send();
  expect(spectrumDataRef.current[0]).toBe(0); expect(spectrumDataRef.playbackId).toBeNull();
  useSceneEnvironment.setState({ visible: true });
  usePlayerStore.setState({ state: 'loading', playbackId: 2 }); send();
  expect(spectrumDataRef.current[0]).toBe(0);
  usePlayerStore.setState({ state: 'playing' }); send();
  expect(spectrumDataRef.current[0]).toBe(0);
  usePlayerStore.setState({ listening: { sessionId: 2, playbackId: 2, state: 'playing', track: null } });
  send(); send(2, Date.now() - 2000); expect(spectrumDataRef.current[0]).toBe(0);
  send(2); expect(spectrumDataRef.current[0]).toBeCloseTo(.7); expect(spectrumDataRef.playbackId).toBe(2);
});
