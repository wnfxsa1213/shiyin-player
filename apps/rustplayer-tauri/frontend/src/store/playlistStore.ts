import { create } from 'zustand';
import { ipc, type PlaylistBrief } from '@/lib/ipc';

interface PlaylistStore {
  playlists: PlaylistBrief[];
  loading: boolean;
  fetchPlaylists: () => Promise<void>;
}

export const usePlaylistStore = create<PlaylistStore>((set) => ({
  playlists: [],
  loading: false,
  fetchPlaylists: async () => {
    set({ loading: true });
    try {
      const results = await ipc.getUserPlaylists();
      set({ playlists: results });
    } catch (e) {
      console.error('Failed to fetch playlists:', e);
    } finally {
      set({ loading: false });
    }
  },
}));
