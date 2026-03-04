import { create } from 'zustand';
import { ipc, type MusicSource, type PlaylistBrief } from '@/lib/ipc';

interface PlaylistStore {
  playlists: PlaylistBrief[];
  loading: boolean;
  fetchPlaylists: (source?: MusicSource) => Promise<void>;
}

export const usePlaylistStore = create<PlaylistStore>((set) => ({
  playlists: [],
  loading: false,
  fetchPlaylists: async (source?: MusicSource) => {
    set({ loading: true });
    try {
      const results = await ipc.getUserPlaylists(source);
      if (source) {
        // Incremental merge: only replace this source's playlists, preserve others
        set((state) => ({
          playlists: [
            ...state.playlists.filter((p) => p.source !== source),
            ...results,
          ],
        }));
      } else {
        // Full fetch on startup: replace all
        set({ playlists: results });
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
