import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { saveSetting } from '@/lib/settings';
import { useToastStore } from '@/store/toastStore';
import { sanitizeError } from '@/lib/errorMessages';

export interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  durationMs: number;
  source: 'netease' | 'qqmusic';
  coverUrl?: string;
  mediaMid?: string;
}

type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'buffering';
export type PlayMode = 'sequence' | 'repeat-one' | 'shuffle';

interface PlayerStore {
  currentTrack: Track | null;
  state: PlayerState;
  positionMs: number;
  durationMs: number;
  /** Unix epoch ms when the backend emitted the most recent progress event. */
  emittedAtMs: number;
  volume: number;
  bufferingPercent: number;
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
  updateProgress: (position: number, duration?: number, emittedAtMs?: number) => void;
  addToQueue: (tracks: Track[]) => void;
  insertNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  setPlayMode: (mode: PlayMode) => void;
  setBuffering: (percent: number) => void;
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

// Non-reactive sequence counter for stale play-request detection.
// Kept outside the store to avoid triggering unnecessary re-renders.
let playSeq = 0;

// --- Behavior tracking state (non-reactive, outside store) ---
let trackingTrack: Track | null = null;
let trackingStartedAt = 0; // Unix epoch seconds when tracking session began
let trackingPlayingMs = 0; // cumulative ms actually spent in 'playing' state
let trackingPlayingSince = 0; // timestamp (ms) when last entered 'playing', 0 if paused

/** Call when player state changes to accumulate actual playing time. */
function onPlayerStateChangeForTracking(newState: string) {
  const now = Date.now();
  if (newState === 'playing') {
    trackingPlayingSince = now;
  } else if (trackingPlayingSince > 0) {
    // Was playing, now paused/stopped/loading — accumulate
    trackingPlayingMs += now - trackingPlayingSince;
    trackingPlayingSince = 0;
  }
}

/** Fire-and-forget: report the previous track's play session to the backend. */
export function flushPlayEvent() {
  if (!trackingTrack || trackingStartedAt === 0) return;
  // Flush any remaining playing time
  if (trackingPlayingSince > 0) {
    trackingPlayingMs += Date.now() - trackingPlayingSince;
    trackingPlayingSince = 0;
  }
  const track = trackingTrack;
  const playedDurationMs = Math.min(trackingPlayingMs, track.durationMs);
  // completed = played >= 80% of track duration, or played >= duration - 10s
  const completed =
    track.durationMs > 0 &&
    (playedDurationMs >= track.durationMs * 0.8 ||
      playedDurationMs >= track.durationMs - 10_000);
  ipc.recordPlayEvent({
    trackId: track.id,
    source: track.source,
    artist: track.artist,
    album: track.album,
    trackDurationMs: track.durationMs,
    playedDurationMs,
    startedAt: trackingStartedAt,
    completed,
  });
  trackingTrack = null;
  trackingStartedAt = 0;
  trackingPlayingMs = 0;
  trackingPlayingSince = 0;
}

// --- Auto-replenish: infinite radio mode ---
let replenishInProgress = false;

/** When the queue is running low, fetch more songs from the backend. */
function autoReplenish() {
  if (replenishInProgress) return;
  const { queue, queueIndex } = usePlayerStore.getState();
  const remaining = queue.length - queueIndex - 1;
  if (remaining > 2 || queue.length === 0) return;

  replenishInProgress = true;
  const excludeKeys = queue.map((t) => `${t.source}:${t.id}`);
  ipc.getRadioBatch(excludeKeys)
    .then((newTracks) => {
      if (newTracks.length > 0) {
        usePlayerStore.getState().addToQueue(newTracks);
      }
    })
    .catch(() => {
      // Silent failure — don't interrupt playback
    })
    .finally(() => {
      replenishInProgress = false;
    });
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  currentTrack: null,
  state: 'idle',
  positionMs: 0,
  durationMs: 0,
  emittedAtMs: 0,
  volume: 1,
  bufferingPercent: 0,
  queue: [],
  queueIndex: -1,
  playMode: 'sequence',
  shuffleOrder: [],
  recentTracks: [],

  play: () => { onPlayerStateChangeForTracking('playing'); set({ state: 'playing' }); },
  pause: () => { onPlayerStateChangeForTracking('paused'); set({ state: 'paused' }); },
  seek: (positionMs) => set({ positionMs }),
  setVolume: (volume) => {
    const v = Math.max(0, Math.min(1, volume));
    saveSetting('volume', v).catch(console.error);
    set({ volume: v });
  },
  setTrack: (track) => set({ currentTrack: track, state: 'loading', positionMs: 0, durationMs: track.durationMs }),
  updateProgress: (positionMs, durationMs, emittedAtMs) => set((s) => ({ positionMs, durationMs: durationMs ?? s.durationMs, emittedAtMs: emittedAtMs ?? s.emittedAtMs })),

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
  clearQueue: () => { flushPlayEvent(); ++playSeq; set({ queue: [], queueIndex: -1, shuffleOrder: [], currentTrack: null, state: 'idle' }); },
  setBuffering: (percent) => {
    onPlayerStateChangeForTracking('loading');
    set({ state: 'buffering', bufferingPercent: percent });
  },
  setPlayMode: (mode) => set((state) => ({
    playMode: mode,
    shuffleOrder: mode === 'shuffle' && state.queue.length > 0
      ? generateShuffleOrder(state.queue.length)
      : [],
  })),
  playFromQueue: (index) => {
    const { queue, currentTrack: previousTrack, queueIndex: previousIndex, state: previousState, durationMs: previousDuration, positionMs: previousPosition, recentTracks: previousRecent } = get();
    if (index >= 0 && index < queue.length) {
      // Flush play event for the track that was playing before this one
      flushPlayEvent();
      const track = queue[index];
      const seq = ++playSeq;
      // Save tracking state before overwriting, so we can rollback on failure
      const prevTrackingTrack = trackingTrack;
      const prevTrackingStartedAt = trackingStartedAt;
      const prevTrackingPlayingMs = trackingPlayingMs;
      const prevTrackingPlayingSince = trackingPlayingSince;
      // Start tracking the new track
      trackingTrack = track;
      trackingStartedAt = Math.floor(Date.now() / 1000);
      trackingPlayingMs = 0;
      trackingPlayingSince = 0;
      ipc.playTrack(track).catch((err) => {
        // Only rollback if this is still the most recent play request
        // This prevents stale failures from overwriting newer successful plays
        if (seq !== playSeq) return;
        useToastStore.getState().addToast('error', `播放失败: ${sanitizeError(err)}`);
        // Rollback tracking state to avoid writing a never-played event
        trackingTrack = prevTrackingTrack;
        trackingStartedAt = prevTrackingStartedAt;
        trackingPlayingMs = prevTrackingPlayingMs;
        trackingPlayingSince = prevTrackingPlayingSince;
        // Rollback to previous track on failure to maintain UI consistency
        set({
          currentTrack: previousTrack,
          queueIndex: previousIndex,
          state: previousState,
          durationMs: previousDuration,
          positionMs: previousPosition,
          recentTracks: previousRecent,
        });
      });
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
      // Auto-replenish: fetch more songs when queue is running low
      autoReplenish();
    }
  },
  playNext: () => {
    const { queue, queueIndex, playMode, shuffleOrder } = get();
    if (queue.length === 0) return;
    if (playMode === 'repeat-one') {
      ipc.seek(0).then(() => ipc.togglePlayback()).catch((err) => {
        useToastStore.getState().addToast('error', `操作失败: ${sanitizeError(err)}`);
      });
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
      ipc.seek(0).then(() => ipc.togglePlayback()).catch((err) => {
        useToastStore.getState().addToast('error', `操作失败: ${sanitizeError(err)}`);
      });
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
