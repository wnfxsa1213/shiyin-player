import { create } from 'zustand';
import { ipc, type MusicSource, type PlaylistBrief } from '@/lib/ipc';

// 两次自动刷新之间的最小冷却时间（避免 visibilitychange 重复触发）
const MIN_FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

interface PlaylistStore {
  playlists: PlaylistBrief[];
  loading: boolean;
  lastFetchedAt: number;
  fetchPlaylists: (source?: MusicSource, force?: boolean) => Promise<void>;
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => ({
  playlists: [],
  loading: false,
  lastFetchedAt: 0,
  fetchPlaylists: async (source?: MusicSource, force = false) => {
    const state = get();

    // 并发锁：已有请求在飞，跳过
    if (state.loading) return;

    // 节流守卫：未达最小刷新间隔时跳过（强制刷新或登录事件可绕过）
    const now = Date.now();
    if (!force && state.lastFetchedAt > 0 && now - state.lastFetchedAt < MIN_FETCH_INTERVAL_MS) {
      return;
    }

    set({ loading: true });
    try {
      const results = await ipc.getUserPlaylists(source);
      if (source) {
        // Incremental merge: only replace this source's playlists, preserve others
        set((s) => ({
          playlists: [
            ...s.playlists.filter((p) => p.source !== source),
            ...results,
          ],
          lastFetchedAt: Date.now(),
        }));
      } else {
        // Full fetch on startup: replace all
        set({ playlists: results, lastFetchedAt: Date.now() });
      }
    } catch (e) {
      console.error(`Failed to fetch playlists${source ? ` for ${source}` : ''}:`, e);
      // Re-throw so caller (e.g. login handler) can show a toast
      if (source) throw e;
    } finally {
      set({ loading: false });
    }
  },
}));
