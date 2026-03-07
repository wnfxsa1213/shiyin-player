import { create } from 'zustand';
import { ipc, type MusicSource } from '@/lib/ipc';
import { usePlayerStore, type Track } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { sanitizeError } from '@/lib/errorMessages';

interface FmStore {
  fmQueue: Track[];
  source: MusicSource;
  loading: boolean;
  setSource: (source: MusicSource) => void;
  fetchMore: () => Promise<void>;
  playNext: () => Promise<void>;
  dislike: () => Promise<void>;
}

const FM_QUEUE_MIN = 2;

export const useFmStore = create<FmStore>((set, get) => ({
  fmQueue: [],
  source: 'netease',
  loading: false,

  setSource: (source) => {
    set({ source, fmQueue: [] });
  },

  fetchMore: async () => {
    const { source, loading } = get();
    if (loading) return;
    set({ loading: true });
    try {
      const tracks = await ipc.getPersonalFm(source);
      set((s) => ({ fmQueue: [...s.fmQueue, ...tracks] }));
    } catch (err) {
      useToastStore.getState().addToast('error', `FM推荐获取失败: ${sanitizeError(err)}`);
    } finally {
      set({ loading: false });
    }
  },

  playNext: async () => {
    const { fmQueue, fetchMore } = get();

    // Ensure we have tracks
    if (fmQueue.length === 0) {
      await fetchMore();
    }

    const queue = get().fmQueue;
    if (queue.length === 0) return;

    const [next, ...rest] = queue;
    set({ fmQueue: rest });

    // Play the track via playerStore's existing mechanisms
    try {
      const ps = usePlayerStore.getState();
      ps.clearQueue();
      ps.addToQueue([next]);
      ps.playFromQueue(0);
    } catch (err) {
      useToastStore.getState().addToast('error', `播放失败: ${sanitizeError(err)}`);
    }

    // Pre-fetch more if running low
    if (rest.length < FM_QUEUE_MIN) {
      fetchMore();
    }
  },

  dislike: async () => {
    // Skip current track and play next
    await get().playNext();
  },
}));
