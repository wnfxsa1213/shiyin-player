import { create } from 'zustand';
import { cloneScene, defaultSceneSettings, parseSceneSettings, sceneAssetId, SCENE_PRESETS, type SceneAsset, type SceneSettings, type VisualScene } from './model';

interface Dependencies {
  load(): Promise<unknown>;
  save(settings: SceneSettings): Promise<void>;
  listAssets(): Promise<SceneAsset[]>;
  importAsset(file: File): Promise<SceneAsset>;
  deleteAsset(id: string): Promise<void>;
  prepare(scene: VisualScene, assets: SceneAsset[]): Promise<void>;
  notify(type: 'info' | 'error' | 'success', message: string): void;
  errorMessage(error: unknown): string;
  newId?: () => string;
}

export interface SceneStore extends Omit<SceneSettings, 'version'> {
  assets: SceneAsset[];
  ready: boolean;
  applying: boolean;
  importing: boolean;
  initialize(): Promise<void>;
  apply(scene: VisualScene, canCommit?: () => boolean): Promise<boolean>;
  saveAs(scene: VisualScene, name: string): VisualScene | null;
  removeSaved(id: string): void;
  setLocked(locked: boolean): void;
  setRotationMember(id: string, member: boolean): void;
  importBackground(file: File): Promise<SceneAsset | null>;
  removeBackground(id: string): Promise<boolean>;
  flush(): Promise<void>;
}

/** Stores user choices; rendering and automatic rotation consume this interface independently. */
export function createSceneStore(deps: Dependencies) {
  let initialization: Promise<void> | null = null;
  let writeQueue: Promise<void> = Promise.resolve();
  let applyGeneration = 0;
  let preparing: VisualScene | null = null;
  const deletingAssets = new Set<string>();
  const fail = (prefix: string, error: unknown) => deps.notify('error', `${prefix}：${deps.errorMessage(error)}`);
  function persist() {
    const { saved, current, rotationIds, locked } = store.getState();
    const snapshot: SceneSettings = { version: 1, saved: saved.map(cloneScene), current: cloneScene(current), rotationIds: [...rotationIds], locked };
    writeQueue = writeQueue.catch(() => {}).then(() => deps.save(snapshot));
    void writeQueue.catch(error => fail('场景设置保存失败', error));
  }
  const store = create<SceneStore>((set, get) => ({
    ...defaultSceneSettings(), assets: [], ready: false, applying: false, importing: false,
    initialize: () => {
      initialization ??= (async () => {
        const [settings, assets] = await Promise.allSettled([deps.load(), deps.listAssets()]);
        if (settings.status === 'rejected') fail('场景设置读取失败', settings.reason);
        if (assets.status === 'rejected') fail('背景素材读取失败', assets.reason);
        set({
          ...(settings.status === 'fulfilled' ? parseSceneSettings(settings.value) : defaultSceneSettings()),
          assets: assets.status === 'fulfilled' ? assets.value : [], ready: true,
        });
      })();
      return initialization;
    },
    apply: async (scene, canCommit = () => true) => {
      if (!get().ready) return false;
      if (deletingAssets.has(sceneAssetId(scene) ?? '')) return false;
      const generation = ++applyGeneration;
      const candidate = cloneScene(scene);
      preparing = candidate;
      set({ applying: true });
      try {
        await deps.prepare(candidate, get().assets);
        if (generation !== applyGeneration || !canCommit()) return false;
        set({ current: candidate });
        persist();
        return true;
      } catch (error) {
        if (generation === applyGeneration) fail('场景加载失败，已保留当前场景', error);
        return false;
      } finally {
        if (generation === applyGeneration) { preparing = null; set({ applying: false }); }
      }
    },
    saveAs: (scene, name) => {
      if (!get().ready) return null;
      if (deletingAssets.has(sceneAssetId(scene) ?? '')) return null;
      if (get().saved.length >= 100) { deps.notify('info', '最多保存 100 套自定义场景，请先移除不再使用的搭配'); return null; }
      const saved = { ...cloneScene(scene), id: `user-${deps.newId?.() ?? crypto.randomUUID()}`, name: (name.trim() || `我的${scene.name}`).slice(0, 64) };
      set(state => ({ saved: [...state.saved, saved] }));
      persist();
      return cloneScene(saved);
    },
    removeSaved: id => {
      if (!get().ready || !get().saved.some(scene => scene.id === id)) return;
      if (get().current.id === id) { deps.notify('info', '请先切换当前场景，再删除这套搭配'); return; }
      set(state => ({ saved: state.saved.filter(scene => scene.id !== id), rotationIds: state.rotationIds.filter(item => item !== id) }));
      persist();
    },
    setLocked: locked => { if (get().ready) { set({ locked }); persist(); } },
    setRotationMember: (id, member) => {
      if (!get().ready || ![...SCENE_PRESETS, ...get().saved].some(scene => scene.id === id)) return;
      set(state => ({ rotationIds: member ? [...new Set([...state.rotationIds, id])] : state.rotationIds.filter(item => item !== id) }));
      persist();
    },
    importBackground: async file => {
      if (!get().ready || get().importing) return null;
      set({ importing: true });
      try {
        const asset = await deps.importAsset(file);
        set(state => ({ assets: [...state.assets.filter(item => item.id !== asset.id), asset] }));
        return asset;
      } catch (error) { fail('背景导入失败', error); return null; }
      finally { set({ importing: false }); }
    },
    removeBackground: async id => {
      if (!get().ready || get().importing) return false;
      if ([get().current, ...get().saved, ...(preparing ? [preparing] : [])].some(scene => sceneAssetId(scene) === id)) {
        deps.notify('info', '这张图片仍被当前场景或已保存搭配使用');
        return false;
      }
      if (deletingAssets.has(id)) return false;
      deletingAssets.add(id);
      try {
        await deps.deleteAsset(id);
        set(state => ({ assets: state.assets.filter(asset => asset.id !== id) }));
        return true;
      } catch (error) { fail('背景删除失败', error); return false; }
      finally { deletingAssets.delete(id); }
    },
    flush: () => writeQueue,
  }));
  return store;
}
