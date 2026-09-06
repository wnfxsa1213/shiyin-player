export const EFFECTS = ['star', 'rain', 'snow', 'firefly', 'meteor', 'bubble', 'petal', 'pulse'] as const;
export type SceneEffect = typeof EFFECTS[number];
export type SceneBackground = { kind: 'gradient' } | { kind: 'cover' } | { kind: 'image'; assetId: string };

export interface VisualScene {
  id: string;
  name: string;
  effect: SceneEffect;
  background: SceneBackground;
  colors: { primary: string; secondary: string; particle: string };
  followMusic: boolean;
}

export interface SceneAsset {
  id: string;
  name: string;
  displayPath: string;
  thumbnailPath: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface SceneSettings {
  version: 1;
  saved: VisualScene[];
  current: VisualScene;
  rotationIds: string[];
  locked: boolean;
}

export const EFFECT_NAMES: Record<SceneEffect, string> = {
  star: '星尘', rain: '细雨', snow: '飘雪', firefly: '萤火',
  meteor: '流星', bubble: '浮泡', petal: '花瓣', pulse: '共振',
};

const palettes: [SceneEffect, string, string, string, string][] = [
  ['star', '星海', '#0b1427', '#35427d', '#b3caf9'],
  ['rain', '雨夜', '#181d36', '#77526b', '#b2bbdf'],
  ['snow', '初雪', '#172539', '#52778e', '#edf7ff'],
  ['firefly', '萤火', '#122c28', '#3c5c2d', '#d6f391'],
  ['meteor', '流星', '#0b142b', '#3f3479', '#b6c7ff'],
  ['bubble', '气泡', '#123344', '#367b91', '#9adee8'],
  ['petal', '花信', '#402638', '#805269', '#f2bace'],
  ['pulse', '共振', '#261d2c', '#945125', '#ffd29a'],
];

export const SCENE_PRESETS: readonly VisualScene[] = palettes.map(([effect, name, primary, secondary, particle]) => ({
  id: effect, name, effect, colors: { primary, secondary, particle },
  background: { kind: 'gradient' }, followMusic: true,
}));

export function cloneScene(scene: VisualScene): VisualScene {
  return { ...scene, colors: { ...scene.colors }, background: { ...scene.background } };
}

export function sameScene(left: VisualScene, right: VisualScene): boolean {
  return left.id === right.id && left.name === right.name && left.effect === right.effect
    && left.followMusic === right.followMusic && left.background.kind === right.background.kind
    && (left.background.kind !== 'image' || (right.background.kind === 'image' && left.background.assetId === right.background.assetId))
    && left.colors.primary === right.colors.primary && left.colors.secondary === right.colors.secondary
    && left.colors.particle === right.colors.particle;
}

export function sceneGradient(scene: VisualScene): string {
  return `radial-gradient(ellipse at 70% 25%, ${scene.colors.secondary}, transparent 65%), linear-gradient(140deg, ${scene.colors.primary}, ${scene.colors.secondary})`;
}

export function sceneAssetId(scene: VisualScene): string | null {
  return scene.background.kind === 'image' ? scene.background.assetId : null;
}

export function defaultSceneSettings(): SceneSettings {
  return { version: 1, saved: [], current: cloneScene(SCENE_PRESETS[0]), rotationIds: ['star', 'rain', 'firefly'], locked: false };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
export function parseScene(value: unknown): VisualScene | null {
  if (!record(value) || typeof value.id !== 'string' || !/^(?:[a-z]+|user-[a-zA-Z0-9-]{1,64})$/.test(value.id)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 64
    || !EFFECTS.includes(value.effect as SceneEffect) || typeof value.followMusic !== 'boolean'
    || !record(value.colors) || !record(value.background)) return null;
  const { primary, secondary, particle } = value.colors;
  if (![primary, secondary, particle].every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) return null;
  const background = value.background;
  if (background.kind !== 'gradient' && background.kind !== 'cover'
    && !(background.kind === 'image' && typeof background.assetId === 'string' && /^[0-9a-f]{64}$/.test(background.assetId))) return null;
  return {
    id: value.id, name: value.name, effect: value.effect as SceneEffect, followMusic: value.followMusic,
    colors: { primary: primary as string, secondary: secondary as string, particle: particle as string },
    background: background.kind === 'image' ? { kind: 'image', assetId: background.assetId as string }
      : { kind: background.kind as 'gradient' | 'cover' },
  };
}

export function parseSceneSettings(value: unknown): SceneSettings {
  if (!record(value) || value.version !== 1) return defaultSceneSettings();
  const saved: VisualScene[] = [];
  const ids = new Set(SCENE_PRESETS.map(scene => scene.id));
  for (const item of Array.isArray(value.saved) ? value.saved.slice(0, 100) : []) {
    const scene = parseScene(item);
    if (scene && scene.id.startsWith('user-') && !ids.has(scene.id)) { saved.push(scene); ids.add(scene.id); }
  }
  return {
    version: 1, saved, current: parseScene(value.current) ?? cloneScene(SCENE_PRESETS[0]),
    rotationIds: Array.isArray(value.rotationIds) ? [...new Set(value.rotationIds.filter((id): id is string => typeof id === 'string' && ids.has(id)))] : ['star', 'rain', 'firefly'],
    locked: value.locked === true,
  };
}
