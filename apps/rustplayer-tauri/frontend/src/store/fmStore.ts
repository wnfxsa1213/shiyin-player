import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { usePlayerStore, type Track } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { sanitizeError } from '@/lib/errorMessages';

interface FmStore {
  fmQueue: Track[];
  loading: boolean;
  fetchMore: () => Promise<void>;
  playNext: () => Promise<void>;
  dislike: () => Promise<void>;
}

const FM_QUEUE_MIN = 2;
let reportedDegradedSources = '';

function sourceNames(sources: Array<'netease' | 'qqmusic'>): string {
  return sources.map((source) => source === 'netease' ? '网易云音乐' : 'QQ音乐').join(' / ');
}

export const useFmStore = create<FmStore>((set, get) => ({
  fmQueue: [],
  loading: false,

  fetchMore: async () => {
    const { fmQueue, loading } = get();
    if (loading) return;
    set({ loading: true });
    try {
      const player = usePlayerStore.getState();
      const knownTracks = [...fmQueue, ...player.queue, ...(player.currentTrack ? [player.currentTrack] : [])];
      const excludeKeys = [...new Set(knownTracks.map((track) => `${track.source}:${track.id}`))];
      const { tracks, discovery } = await ipc.getRadioBatch(excludeKeys);

      if (discovery.outcome === 'degraded') {
        const available = sourceNames(discovery.availableSources);
        if (available && available !== reportedDegradedSources) {
          reportedDegradedSources = available;
          useToastStore.getState().addToast('info', `部分音源暂不可用，当前来自：${available}`);
        }
      } else if (discovery.outcome === 'complete') {
        reportedDegradedSources = '';
      }

      if (discovery.outcome === 'unavailable') {
        useToastStore.getState().addToast('info', '暂时无法获取 FM 推荐，请稍后重试');
        return;
      }

      set((state) => {
        const queue = [...state.fmQueue];
        for (const track of tracks) {
          if (!queue.some((current) => current.id === track.id && current.source === track.source)) {
            queue.push(track);
          }
        }
        return { fmQueue: queue };
      });
    } catch (err) {
      useToastStore.getState().addToast('error', `FM推荐获取失败: ${sanitizeError(err)}`);
    } finally {
      set({ loading: false });
    }
  },

  playNext: async () => {
    const { fmQueue, fetchMore } = get();

    if (fmQueue.length === 0) {
      await fetchMore();
    }

    const queue = get().fmQueue;
    if (queue.length === 0) return;

    const [next, ...rest] = queue;
    set({ fmQueue: rest });

    try {
      const player = usePlayerStore.getState();
      player.clearQueue();
      player.addToQueue([next]);
      player.playFromQueue(0);
    } catch (err) {
      useToastStore.getState().addToast('error', `播放失败: ${sanitizeError(err)}`);
    }

    if (rest.length < FM_QUEUE_MIN) {
      fetchMore();
    }
  },

  dislike: async () => {
    await get().playNext();
  },
}));
