import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Track } from '@/store/playerStore';

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

async function invokeWithTrace<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const traceId = newTraceId();
  for (let attempt = 0; ; attempt++) {
    try {
      return await invoke<T>(cmd, { ...(args ?? {}), traceId });
    } catch (e) {
      const wrapped = wrapInvokeError(e, traceId);
      const kind = (wrapped as { kind?: string }).kind;
      if (attempt < MAX_RETRIES && kind && RETRYABLE_KINDS.has(kind)) {
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
}

export const ipc = {
  searchMusic: (query: string, source?: MusicSource) =>
    invokeWithTrace<Track[]>('search_music', { query, source }),

  playTrack: (track: Track) =>
    invokeWithTrace<void>('play_track', { track }),

  togglePlayback: () => invokeWithTrace<void>('toggle_playback'),

  seek: (positionMs: number) => invokeWithTrace<void>('seek', { positionMs }),

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
    invokeWithTrace<Track[]>('get_radio_batch', { excludeKeys }),

  extractCoverColor: (url: string) =>
    invokeWithTrace<[number, number, number]>('extract_cover_color', { url }),

  // Best-effort frontend->backend log relay (for release debugging).
  clientLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string, traceId?: string) => {
    const id = traceId ?? newTraceId();
    return invoke<void>('client_log', { level, message, traceId: id }).catch(() => {});
  },
};

export function onPlayerState(cb: (state: string) => void): Promise<UnlistenFn> {
  return listen<string>('player://state', (e) => cb(e.payload));
}

export function onPlayerProgress(cb: (p: { positionMs: number; durationMs: number; emittedAtMs?: number }) => void): Promise<UnlistenFn> {
  return listen<{ positionMs: number; durationMs: number; emittedAtMs?: number }>('player://progress', (e) => cb(e.payload));
}

export function onPlayerError(cb: (error: string) => void): Promise<UnlistenFn> {
  return listen<string>('player://error', (e) => cb(e.payload));
}

export function onPlayerSpectrum(cb: (data: { magnitudes: number[] }) => void): Promise<UnlistenFn> {
  return listen<{ magnitudes: number[] }>('player://spectrum', (e) => cb(e.payload));
}

export function onPlayerBuffering(cb: (percent: number) => void): Promise<UnlistenFn> {
  return listen<number>('player://buffering', (e) => cb(e.payload));
}

export function onLoginSuccess(cb: (source: MusicSource) => void): Promise<UnlistenFn> {
  return listen<MusicSource>('login://success', (e) => cb(e.payload));
}

export function onLoginTimeout(cb: (source: MusicSource) => void): Promise<UnlistenFn> {
  return listen<MusicSource>('login://timeout', (e) => cb(e.payload));
}
