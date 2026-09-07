import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Track } from '@/store/playerStore';
import type { PlaybackEvent } from '@/lib/playbackLifecycle';
import type { SceneAsset } from '@/lib/scenes/model';

export type MusicSource = 'netease' | 'qqmusic';

let traceSeq = 0;

function newTraceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const ms = Date.now().toString(16);
  const seq = (++traceSeq).toString(16);
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16);
  return `${ms}-${seq}-${rand}`;
}

function wrapInvokeError(error: unknown, traceId: string) {
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    obj.traceId = traceId;
    // Ensure `kind` is always present so sanitizeError can handle it uniformly.
    if (!('kind' in obj)) {
      return { kind: 'internal', message: obj.message ?? String(error), traceId };
    }
    return obj;
  }
  return { kind: 'internal', message: String(error ?? 'unknown error'), traceId };
}

// Transient error kinds eligible for automatic retry.
const RETRYABLE_KINDS = new Set(['network', 'rate_limited']);
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 200;

async function invokeWithTrace<T>(cmd: string, args?: Record<string, unknown>, retry = true): Promise<T> {
  const traceId = newTraceId();
  for (let attempt = 0; ; attempt++) {
    try {
      return await invoke<T>(cmd, { ...(args ?? {}), traceId });
    } catch (e) {
      const wrapped = wrapInvokeError(e, traceId);
      const kind = (wrapped as { kind?: string }).kind;
      if (retry && attempt < MAX_RETRIES && kind && RETRYABLE_KINDS.has(kind)) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (1 << attempt)));
        continue;
      }
      throw wrapped;
    }
  }
}

export interface PlaylistBrief {
  id: string;
  name: string;
  coverUrl?: string;
  trackCount: number;
  source: MusicSource;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  tracks: Track[];
  source: MusicSource;
}

export interface PlayEvent {
  trackId: string;
  source: MusicSource;
  artist: string;
  album: string;
  trackDurationMs: number;
  playedDurationMs: number;
  startedAt: number;
  completed: boolean;
}

export interface ArtistPreference {
  artist: string;
  playCount: number;
  avgCompletionRate: number;
  lastPlayedAt: number;
  score: number;
}

export interface RecommendResult {
  personalized: Track[];
  topArtists: ArtistPreference[];
  rediscover: Track[];
  discovery: MusicDiscoveryStatus;
}

export interface RadioBatchResult {
  tracks: Track[];
  discovery: MusicDiscoveryStatus;
}

export interface MusicDiscoveryStatus {
  outcome: 'complete' | 'degraded' | 'empty' | 'unavailable';
  availableSources: MusicSource[];
  unavailableSources: MusicSource[];
}

export const ipc = {
  listSceneBackgrounds: () => invokeWithTrace<SceneAsset[]>('list_scene_backgrounds', undefined, false),
  deleteSceneBackground: (assetId: string) => invokeWithTrace<void>('delete_scene_background', { assetId }, false),
  sceneAssetUrl: (path: string) => convertFileSrc(path, 'scene'),
  importSceneBackground: async (file: File): Promise<SceneAsset> => {
    const traceId = newTraceId();
    try {
      if (!file.size || file.size > 20 * 1024 * 1024) throw { kind: 'invalid_input', message: '请选择 20 MB 以内的图片' };
      return await invoke<SceneAsset>('import_scene_background', await file.arrayBuffer(), {
        headers: { 'x-trace-id': traceId, 'x-file-name': encodeURIComponent(file.name) },
      });
    } catch (error) { throw wrapInvokeError(error, traceId); }
  },

  searchMusic: (query: string, source?: MusicSource) =>
    invokeWithTrace<Track[]>('search_music', { query, source }),

  playTrack: (track: Track, playbackId: number, positionMs = 0, paused = false) =>
    invokeWithTrace<void>('play_track', { track, playbackId, positionMs, paused }, false),

  setPlaybackPaused: (playbackId: number, paused: boolean) =>
    invokeWithTrace<void>('set_playback_paused', { playbackId, paused }, false),

  stopPlayback: (playbackId: number) => invokeWithTrace<void>('stop_playback', { playbackId }, false),

  seek: (playbackId: number, positionMs: number) => invokeWithTrace<void>('seek', { playbackId, positionMs }, false),

  setVolume: (volume: number) => invokeWithTrace<void>('set_volume', { volume }),

  getLyrics: (trackId: string, source: MusicSource) =>
    invokeWithTrace<{ time_ms: number; text: string; translation: string | null }[]>('get_lyrics', { trackId, source }),

  login: (source: MusicSource, cookie: string) =>
    invokeWithTrace<{ access_token: string; expires_at: number | null }>('login', {
      source,
      credentials: { type: 'cookie', cookie },
    }),

  logout: (source: MusicSource) =>
    invokeWithTrace<void>('logout', { source }),

  openLoginWindow: (source: MusicSource) =>
    invokeWithTrace<void>('open_login_window', { source }),

  checkLoginStatus: () =>
    invokeWithTrace<Record<MusicSource, boolean>>('check_login_status'),

  getUserPlaylists: (source?: MusicSource) =>
    invokeWithTrace<PlaylistBrief[]>('get_user_playlists', { source }),

  getPlaylistDetail: (id: string, source: MusicSource) =>
    invokeWithTrace<Playlist>('get_playlist_detail', { id, source }),

  getDailyRecommend: (source: MusicSource) =>
    invokeWithTrace<Track[]>('get_daily_recommend', { source }),

  getPersonalFm: (source: MusicSource) =>
    invokeWithTrace<Track[]>('get_personal_fm', { source }),

  recordPlayEvent: (event: PlayEvent) =>
    invoke<void>('record_play_event', { event, traceId: newTraceId() }).catch(() => {}),

  getSmartRecommend: () =>
    invokeWithTrace<RecommendResult>('get_smart_recommend'),

  getRadioBatch: (excludeKeys: string[]) =>
    invokeWithTrace<RadioBatchResult>('get_radio_batch', { excludeKeys }),

  extractCoverColor: (url: string) =>
    invokeWithTrace<[number, number, number]>('extract_cover_color', { url }),

  // Best-effort frontend->backend log relay (for release debugging).
  clientLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string, traceId?: string) => {
    const id = traceId ?? newTraceId();
    return invoke<void>('client_log', { level, message, traceId: id }).catch(() => {});
  },
};

export function onPlaybackEvent(cb: (event: PlaybackEvent) => void): Promise<UnlistenFn> {
  return listen<PlaybackEvent>('player://event', (event) => cb(event.payload));
}

export interface PlayerSpectrum { playbackId: number; emittedAtMs: number; magnitudes: number[] }

export function onPlayerSpectrum(cb: (data: PlayerSpectrum) => void): Promise<UnlistenFn> {
  return listen<PlayerSpectrum>('player://spectrum', (e) => cb(e.payload));
}

export function onLoginSuccess(cb: (source: MusicSource) => void): Promise<UnlistenFn> {
  return listen<MusicSource>('login://success', (e) => cb(e.payload));
}

export function onLoginTimeout(cb: (source: MusicSource) => void): Promise<UnlistenFn> {
  return listen<MusicSource>('login://timeout', (e) => cb(e.payload));
}

export async function isPlayerWindowVisible(): Promise<boolean> {
  const window = getCurrentWindow();
  const [visible, minimized] = await Promise.all([window.isVisible(), window.isMinimized()]);
  return visible && !minimized;
}

export async function onPlayerWindowChanged(cb: () => void): Promise<UnlistenFn> {
  const window = getCurrentWindow();
  const results = await Promise.allSettled([window.onFocusChanged(cb), window.onResized(cb)]);
  const cleanups = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  return () => cleanups.forEach(cleanup => cleanup());
}
