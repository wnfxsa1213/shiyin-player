import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Track } from '@/store/playerStore';

export interface PlaylistBrief {
  id: string;
  name: string;
  coverUrl?: string;
  trackCount: number;
  source: 'netease' | 'qqmusic';
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  tracks: Track[];
  source: 'netease' | 'qqmusic';
}

export const ipc = {
  searchMusic: (query: string, source?: string) =>
    invoke<Track[]>('search_music', { query, source }),

  playTrack: (track: Track) =>
    invoke<void>('play_track', { track }),

  togglePlayback: () => invoke<void>('toggle_playback'),

  seek: (positionMs: number) => invoke<void>('seek', { positionMs }),

  setVolume: (volume: number) => invoke<void>('set_volume', { volume }),

  getLyrics: (trackId: string, source: string) =>
    invoke<{ time_ms: number; text: string; translation: string | null }[]>('get_lyrics', { trackId, source }),

  login: (source: string, cookie: string) =>
    invoke<{ access_token: string; expires_at: number | null }>('login', {
      source,
      credentials: { type: 'cookie', cookie },
    }),

  logout: (source: string) =>
    invoke<void>('logout', { source }),

  getUserPlaylists: (source?: string) =>
    invoke<PlaylistBrief[]>('get_user_playlists', { source }),

  getPlaylistDetail: (id: string, source: string) =>
    invoke<Playlist>('get_playlist_detail', { id, source }),

  extractCoverColor: (url: string) =>
    invoke<[number, number, number]>('extract_cover_color', { url }),
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
