// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareImage } from '@/lib/scenes/assets';

const images: TestImage[] = [];
class TestImage {
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode = vi.fn().mockResolvedValue(undefined);
  constructor() { images.push(this); }
}
vi.mock('@/lib/ipc', () => ({ ipc: {} }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('Image', TestImage); images.length = 0; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('共享图片只加载一次，取消旧预览不会中断仍在使用的场景', async () => {
  const left = new AbortController(), right = new AbortController();
  const first = prepareImage('shared.webp', left.signal), second = prepareImage('shared.webp', right.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  expect(images).toHaveLength(1); left.abort(); await rejected;
  expect(images[0].src).toBe('shared.webp'); images[0].onload?.(); await second;
  expect(images[0].decode).toHaveBeenCalledTimes(1);
});

it('快速离开预览会释放未完成的请求，再选同图不会复用已取消任务', async () => {
  const controller = new AbortController();
  const pending = prepareImage('abandoned.webp', controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); expect(images[0].src).toBe('');
  const replacement = prepareImage('abandoned.webp'); await rejected;
  expect(images).toHaveLength(2); images[1].onload?.(); await replacement;
});

it('加载超时清理图像引用，后续调用能够重试', async () => {
  const pending = prepareImage('timeout.webp'); const rejected = expect(pending).rejects.toThrow('图片加载超时');
  await vi.advanceTimersByTimeAsync(8000); await rejected; expect(images[0].src).toBe('');
  const retry = prepareImage('timeout.webp'); images[1].onload?.(); await retry;
});
