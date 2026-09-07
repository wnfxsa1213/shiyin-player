// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ScenesView from '@/views/ScenesView';
import SceneSurface from '@/components/scenes/SceneSurface';
import { defaultSceneSettings } from '@/lib/scenes/model';
import { useSceneStore } from '@/store/sceneStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { usePlayerStore } from '@/store/playerStore';
import { useUiStore } from '@/store/uiStore';
import { useVisualizerStore } from '@/store/visualizerStore';

vi.mock('@/lib/settings', () => ({ loadSetting: vi.fn().mockResolvedValue(null), saveSetting: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/ipc', () => ({ ipc: { listSceneBackgrounds: vi.fn().mockResolvedValue([]), getLyrics: vi.fn().mockResolvedValue([]) } }));

const frames = new Map<number, FrameRequestCallback>();
const paints = new Map<HTMLCanvasElement, number>();
let nextFrame = 0, frameTime = 0;

function advanceFrame() {
  const scheduled = [...frames.values()]; frames.clear(); frameTime += 40;
  act(() => { scheduled.forEach(callback => callback(frameTime)); });
}

beforeEach(async () => {
  frames.clear(); paints.clear(); nextFrame = frameTime = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target, contentRect: { width: 600, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  // Supply jsdom's missing drawing APIs and a controllable frame clock. The real
  // page, Surface and renderer still decide when to schedule and paint frames.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const canvas = this;
    return {
      createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, setTransform() {}, drawImage() {},
      clearRect: () => { paints.set(canvas, (paints.get(canvas) ?? 0) + 1); },
    } as unknown as CanvasRenderingContext2D;
  });
  await useSceneStore.getState().initialize();
  useSceneStore.setState({ ...defaultSceneSettings(), assets: [], ready: true, applying: false, importing: false });
  useSceneEnvironment.setState({ visible: true, reducedMotion: false, editorOpen: false });
  useVisualizerStore.setState({ enabled: true, showParticles: true });
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  useUiStore.setState({ immersiveOpen: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['idle', 'paused'] as const)('%s 时展开候选仍连续绘制，隐藏的小预览停绘，退出恢复小预览', state => {
  usePlayerStore.setState({ state });
  const { container, unmount } = render(<ScenesView />);
  const small = container.querySelector<HTMLCanvasElement>('.scene-preview canvas')!;
  const initial = paints.get(small) ?? 0; advanceFrame();
  expect(paints.get(small)).toBeGreaterThan(initial);
  const trigger = screen.getByRole('button', { name: '沉浸预览' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: '沉浸预览' });
  const large = dialog.querySelector('canvas')!;
  const largeBefore = paints.get(large) ?? 0, smallBefore = paints.get(small);
  advanceFrame(); advanceFrame();
  expect(paints.get(large)).toBeGreaterThan(largeBefore);
  expect(paints.get(small)).toBe(smallBefore);
  expect(dialog.querySelector('.scene-surface--immersive')).toBeTruthy();
  expect(useSceneStore.getState().current.id).toBe('star');
  fireEvent.click(screen.getByRole('button', { name: '返回搭配' }));
  expect(document.activeElement).toBe(trigger);
  const resumed = paints.get(small) ?? 0; advanceFrame();
  expect(paints.get(small)).toBeGreaterThan(resumed);
  unmount(); expect(frames.size).toBe(0);
});

it('沉浸预览仍遵守窗口可见性、减少动态效果和粒子开关', () => {
  render(<ScenesView />);
  fireEvent.click(screen.getByRole('button', { name: '沉浸预览' }));
  expect(frames.size).toBe(1);
  act(() => useSceneEnvironment.setState({ visible: false })); expect(frames.size).toBe(0);
  act(() => useSceneEnvironment.setState({ visible: true })); expect(frames.size).toBe(1);
  act(() => useSceneEnvironment.setState({ reducedMotion: true })); expect(frames.size).toBe(0);
  act(() => useSceneEnvironment.setState({ reducedMotion: false })); expect(frames.size).toBe(1);
  act(() => useVisualizerStore.setState({ showParticles: false })); expect(frames.size).toBe(0);
  act(() => useVisualizerStore.setState({ showParticles: true })); expect(frames.size).toBe(1);
});

it('正式主界面和沉浸背景仍只在实际播放时连续绘制', () => {
  const scene = defaultSceneSettings().current;
  render(<><SceneSurface scene={scene} variant="main" /><SceneSurface scene={scene} /></>);
  expect(frames.size).toBe(0);
  act(() => usePlayerStore.setState({ playbackId: 1, state: 'playing', listening: { playbackId: 1, sessionId: 1, track: null, state: 'playing' } }));
  expect(frames.size).toBe(2);
  act(() => usePlayerStore.setState({ state: 'paused' })); expect(frames.size).toBe(0);
});
