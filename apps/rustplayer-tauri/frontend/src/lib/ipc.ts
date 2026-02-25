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

function invokeWithTrace<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const traceId = newTraceId();
  return invoke<T>(cmd, { ...(args ?? {}), traceId }).catch((e) => {
    throw wrapInvokeError(e, traceId);
  });
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

export function onPlayerProgress(cb: (p: { positionMs: number; durationMs: number }) => void): Promise<UnlistenFn> {
  return listen<{ positionMs: number; durationMs: number }>('player://progress', (e) => cb(e.payload));
}

export function onPlayerError(cb: (error: string) => void): Promise<UnlistenFn> {
  return listen<string>('player://error', (e) => cb(e.payload));
}

export function onPlayerSpectrum(cb: (data: { magnitudes: number[] }) => void): Promise<UnlistenFn> {
  return listen<{ magnitudes: number[] }>('player://spectrum', (e) => cb(e.payload));
}

export function onLoginSuccess(cb: (source: MusicSource) => void): Promise<UnlistenFn> {
  return listen<MusicSource>('login://success', (e) => cb(e.payload));
}

export function onLoginTimeout(cb: (source: MusicSource) => void): Promise<UnlistenFn> {
  return listen<MusicSource>('login://timeout', (e) => cb(e.payload));
}
