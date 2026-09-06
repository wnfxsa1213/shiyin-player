import { createSceneStore } from '@/lib/scenes/sceneStore';
import { prepareBackground } from '@/lib/scenes/assets';
import { loadSetting, saveSetting } from '@/lib/settings';
import { ipc } from '@/lib/ipc';
import { sanitizeError } from '@/lib/errorMessages';
import { usePlayerStore } from './playerStore';
import { useToastStore } from './toastStore';

export const useSceneStore = createSceneStore({
  load: () => loadSetting('visualScenes.v1'),
  save: value => saveSetting('visualScenes.v1', value),
  listAssets: ipc.listSceneBackgrounds,
  importAsset: ipc.importSceneBackground,
  deleteAsset: ipc.deleteSceneBackground,
  prepare: (scene, assets) => prepareBackground(scene, assets, usePlayerStore.getState().listening.track?.coverUrl),
  notify: (type, message) => useToastStore.getState().addToast(type, message),
  errorMessage: sanitizeError,
});
