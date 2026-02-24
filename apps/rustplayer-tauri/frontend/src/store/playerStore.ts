import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { saveSetting } from '@/lib/settings';

export interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  durationMs: number;
  source: 'netease' | 'qqmusic';
  coverUrl?: string;
}

type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped';
export type PlayMode = 'sequence' | 'repeat-one' | 'shuffle';

interface PlayerStore {
  currentTrack: Track | null;
  state: PlayerState;
  positionMs: number;
  durationMs: number;
  volume: number;
  queue: Track[];
  queueIndex: number;
  playMode: PlayMode;
  shuffleOrder: number[];
  recentTracks: Track[];
  play: () => void;
  pause: () => void;
  seek: (position: number) => void;
  setVolume: (volume: number) => void;
  setTrack: (track: Track) => void;
  updateProgress: (position: number, duration?: number) => void;
  addToQueue: (tracks: Track[]) => void;
  insertNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  setPlayMode: (mode: PlayMode) => void;
  playFromQueue: (index: number) => void;
  playNext: () => void;
  playPrev: () => void;
}

function generateShuffleOrder(length: number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  currentTrack: null,
  state: 'idle',
  positionMs: 0,
  durationMs: 0,
  volume: 1,
  queue: [],
  queueIndex: -1,
  playMode: 'sequence',
  shuffleOrder: [],
  recentTracks: [],

  play: () => set({ state: 'playing' }),
  pause: () => set({ state: 'paused' }),
  seek: (positionMs) => set({ positionMs }),
  setVolume: (volume) => {
    const v = Math.max(0, Math.min(1, volume));
    saveSetting('volume', v).catch(console.error);
    set({ volume: v });
  },
  setTrack: (track) => set({ currentTrack: track, state: 'loading', positionMs: 0, durationMs: track.durationMs }),
  updateProgress: (positionMs, durationMs) => set((s) => ({ positionMs, durationMs: durationMs ?? s.durationMs })),

  addToQueue: (tracks) => set((state) => {
    const newQueue = [...state.queue];
    for (const t of tracks) {
      if (!newQueue.some((e) => e.id === t.id && e.source === t.source)) {
        newQueue.push(t);
      }
    }
    return { queue: newQueue };
  }),
  insertNext: (track) => set((state) => {
    const newQueue = [...state.queue];
    const insertAt = state.queueIndex >= 0 ? state.queueIndex + 1 : newQueue.length;
    newQueue.splice(insertAt, 0, track);
    return { queue: newQueue };
  }),
  removeFromQueue: (index) => {
    const state = get();
    const newQueue = [...state.queue];
    newQueue.splice(index, 1);
    let newIndex = state.queueIndex;
    if (index < state.queueIndex) {
      newIndex--;
    } else if (index === state.queueIndex) {
      // Removed the currently playing track — use playNext to respect play mode
      if (newQueue.length === 0) {
        set({ queue: newQueue, queueIndex: -1, currentTrack: null, state: 'idle', shuffleOrder: [] });
        return;
      }
      // Adjust index so playNext calculates correctly from the removed position
      const adjustedIdx = index < newQueue.length ? index - 1 : newQueue.length - 1;
      set({ queue: newQueue, queueIndex: adjustedIdx, shuffleOrder: state.playMode === 'shuffle' ? generateShuffleOrder(newQueue.length) : [] });
      get().playNext();
      return;
    }
    set({ queue: newQueue, queueIndex: newIndex });
  },
  clearQueue: () => set({ queue: [], queueIndex: -1, shuffleOrder: [] }),
  setPlayMode: (mode) => set((state) => ({
    playMode: mode,
    shuffleOrder: mode === 'shuffle' && state.queue.length > 0
      ? generateShuffleOrder(state.queue.length)
      : [],
  })),
  playFromQueue: (index) => {
    const { queue } = get();
    if (index >= 0 && index < queue.length) {
      const track = queue[index];
      ipc.playTrack(track).catch(console.error);
      set((s) => ({
        queueIndex: index,
        currentTrack: track,
        state: 'loading',
        positionMs: 0,
        durationMs: track.durationMs,
        recentTracks: [track, ...s.recentTracks.filter(
          (t) => !(t.id === track.id && t.source === track.source)
        )].slice(0, 10),
      }));
    }
  },
  playNext: () => {
    const { queue, queueIndex, playMode, shuffleOrder } = get();
    if (queue.length === 0) return;
    if (playMode === 'repeat-one') {
      ipc.seek(0).then(() => ipc.togglePlayback()).catch(console.error);
      return;
    }
    let next: number;
    if (playMode === 'shuffle') {
      const si = shuffleOrder.indexOf(queueIndex);
      next = shuffleOrder[(si + 1) % shuffleOrder.length];
    } else {
      next = (queueIndex + 1) % queue.length;
    }
    get().playFromQueue(next);
  },
  playPrev: () => {
    const { queue, queueIndex, playMode, shuffleOrder } = get();
    if (queue.length === 0) return;
    if (playMode === 'repeat-one') {
      ipc.seek(0).then(() => ipc.togglePlayback()).catch(console.error);
      return;
    }
    let prev: number;
    if (playMode === 'shuffle') {
      const si = shuffleOrder.indexOf(queueIndex);
      prev = shuffleOrder[(si - 1 + shuffleOrder.length) % shuffleOrder.length];
    } else {
      prev = (queueIndex - 1 + queue.length) % queue.length;
    }
    get().playFromQueue(prev);
  },
}));
