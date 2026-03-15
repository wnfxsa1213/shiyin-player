import { create } from 'zustand';
import { ipc, type ArtistPreference, type RecommendResult } from '@/lib/ipc';
import type { Track } from '@/store/playerStore';

interface RecommendStore {
  personalized: Track[];
  topArtists: ArtistPreference[];
  rediscover: Track[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number;
  fetchRecommendations: () => Promise<void>;
}

const REFRESH_COOLDOWN_MS = 30_000; // 30 seconds

export const useRecommendStore = create<RecommendStore>((set, get) => ({
  personalized: [],
  topArtists: [],
  rediscover: [],
  loading: false,
  error: null,
  lastFetchedAt: 0,

  fetchRecommendations: async () => {
    const { loading, lastFetchedAt } = get();
    if (loading) return;
    if (Date.now() - lastFetchedAt < REFRESH_COOLDOWN_MS) return;

    set({ loading: true, error: null });
    try {
      const result: RecommendResult = await ipc.getSmartRecommend();
      set({
        personalized: result.personalized,
        topArtists: result.topArtists,
        rediscover: result.rediscover,
        loading: false,
        lastFetchedAt: Date.now(),
      });
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
      set({ loading: false, error: msg });
    }
  },
}));
