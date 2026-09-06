// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PlaybackProgress from '@/components/player/PlaybackProgress';
import { usePlayerStore } from '@/store/playerStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';

vi.mock('@/lib/ipc', () => ({ ipc: {} }));
vi.mock('@/lib/settings', () => ({ saveSetting: vi.fn().mockResolvedValue(undefined) }));
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const seek = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  seek.mockClear(); frames.clear(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  useSceneEnvironment.setState({ visible: true, reducedMotion: false });
  usePlayerStore.setState({ ...usePlayerStore.getInitialState(), playbackId: 1, state: 'paused', positionMs: 1000, durationMs: 100_000, seek }, true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('暂停不保留帧循环，播放后启动，隐藏与减少动态效果会停止插值', () => {
  render(<PlaybackProgress />); expect(frames.size).toBe(0);
  act(() => usePlayerStore.setState({ state: 'playing' })); expect(frames.size).toBe(1);
  act(() => useSceneEnvironment.setState({ visible: false })); expect(frames.size).toBe(0);
  act(() => useSceneEnvironment.setState({ visible: true })); expect(frames.size).toBe(1);
  act(() => useSceneEnvironment.setState({ reducedMotion: true })); expect(frames.size).toBe(0);
});

it('取消拖动立即恢复实际进度，松手提交仍绑定原播放尝试', () => {
  render(<PlaybackProgress />);
  const slider = screen.getByRole('slider', { name: '播放进度' }) as HTMLInputElement;
  fireEvent.pointerDown(slider); fireEvent.change(slider, { target: { value: '20000' } });
  fireEvent.pointerCancel(window); expect(seek).not.toHaveBeenCalled(); expect(slider.value).toBe('1000');
  expect(screen.getByText('0:01')).toBeTruthy();
  fireEvent.pointerDown(slider); fireEvent.change(slider, { target: { value: '30000' } });
  act(() => usePlayerStore.setState({ playbackId: 2 })); fireEvent.pointerUp(window);
  expect(seek).toHaveBeenCalledWith(30000, 1);
  expect(slider.value).toBe('1000');
});
