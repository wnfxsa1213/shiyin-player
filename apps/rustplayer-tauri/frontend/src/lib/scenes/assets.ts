import { ipc } from '@/lib/ipc';
import type { SceneAsset, VisualScene } from './model';

export function backgroundUrl(scene: VisualScene, assets: SceneAsset[], coverUrl?: string | null, thumbnail = false): string | null {
  if (scene.background.kind === 'cover') return coverUrl || null;
  if (scene.background.kind !== 'image') return null;
  const id = scene.background.assetId;
  const asset = assets.find(item => item.id === id);
  return asset ? ipc.sceneAssetUrl(thumbnail ? asset.thumbnailPath : asset.displayPath) : null;
}

// Only in-flight decodes are shared. Decoded images are not retained in an unbounded JS cache.
interface ImageLoad { promise: Promise<void>; cancel(): void; users: number; }
const loading = new Map<string, ImageLoad>();
const aborted = () => new DOMException('预览已切换', 'AbortError');
export function prepareImage(url: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(aborted());
  let entry = loading.get(url);
  if (!entry) {
    let cancel = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      const image = new Image();
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true; clearTimeout(timer); image.onload = image.onerror = null;
        if (error) { image.src = ''; reject(error); } else resolve();
      };
      const timer = setTimeout(() => finish(new Error('图片加载超时')), 8000);
      cancel = () => finish(aborted());
      image.onerror = () => finish(new Error('无法读取背景图片'));
      image.onload = () => { void image.decode().then(() => finish(), () => finish(new Error('无法解码背景图片'))); };
      image.src = url;
    });
    entry = { promise, cancel, users: 0 }; loading.set(url, entry);
    const created = entry;
    void promise.finally(() => { if (loading.get(url) === created) loading.delete(url); }).catch(() => {});
  }
  const shared = entry; shared.users++;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', abort);
      if (--shared.users === 0) {
        if (loading.get(url) === shared) loading.delete(url);
        shared.cancel();
      }
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(aborted());
    signal?.addEventListener('abort', abort, { once: true });
    void shared.promise.then(() => finish(), finish);
  });
}

export async function prepareBackground(scene: VisualScene, assets: SceneAsset[], coverUrl?: string | null) {
  const url = backgroundUrl(scene, assets, coverUrl);
  if (scene.background.kind === 'image' && !url) throw new Error('背景素材已丢失，请重新导入');
  if (url) await prepareImage(url);
}
