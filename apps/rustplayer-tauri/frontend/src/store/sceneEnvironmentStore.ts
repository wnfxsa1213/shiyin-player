import { create } from 'zustand';

/** Low-frequency visibility facts shared by rendering, progress and rotation. */
export const useSceneEnvironment = create(() => ({
  visible: true,
  reducedMotion: false,
  editorOpen: false,
}));
