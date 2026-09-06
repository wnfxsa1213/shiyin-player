import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { PlayEvent, RadioBatchResult } from '@/lib/ipc';

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

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'buffering';
export type PlayMode = 'sequence' | 'repeat-one' | 'shuffle';
export type PlaybackEvent =
  | { type: 'state'; playbackId: number; state: PlayerState; positionMs: number }
  | { type: 'progress'; playbackId: number; positionMs: number; durationMs: number; emittedAtMs: number }
  | { type: 'buffering'; playbackId: number; percent: number }
  | { type: 'error'; playbackId: number; message: string }
  | { type: 'ended'; playbackId: number };

export interface PlaybackEngine {
  playTrack(track: Track, playbackId: number, positionMs: number, paused: boolean): Promise<void>;
  setPlaybackPaused(playbackId: number, paused: boolean): Promise<void>;
  seek(playbackId: number, positionMs: number): Promise<void>;
  stopPlayback(playbackId: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
}

interface Dependencies {
  engine: PlaybackEngine;
  recordPlayEvent(event: PlayEvent): Promise<void>;
  getRadioBatch(excludeKeys: string[]): Promise<RadioBatchResult>;
  notifyDiscovery(result: RadioBatchResult['discovery']): void;
  notify(type: 'info' | 'error', message: string): void;
  errorMessage(error: unknown): string;
  saveVolume(volume: number): Promise<void>;
  now?: () => number;
  random?: () => number;
}

export interface PlayerStore {
  currentTrack: Track | null;
  playbackId: number | null;
  state: PlayerState;
  playWhenReady: boolean;
  positionMs: number;
  durationMs: number;
  emittedAtMs: number;
  volume: number;
  bufferingPercent: number;
  queue: Track[];
  queueIndex: number;
  playMode: PlayMode;
  shuffleOrder: number[];
  recentTracks: Track[];
  togglePlayback(): Promise<void>;
  seek(positionMs: number, expectedPlaybackId?: number | null): Promise<void>;
  setVolume(volume: number): void;
  addToQueue(tracks: Track[]): void;
  insertNext(track: Track): void;
  removeFromQueue(index: number): void;
  clearQueue(): Promise<void>;
  setPlayMode(mode: PlayMode): void;
  playFromQueue(index: number): Promise<void>;
  playNext(): Promise<void>;
  playPrev(): Promise<void>;
  handlePlaybackEvent(event: PlaybackEvent): void;
  shutdown(): void;
}

interface ListeningSession {
  track: Track;
  state: PlayerState;
  positionMs: number;
  durationMs: number;
  startedAt: number | null;
  playingSince: number | null;
  playedMs: number;
  reported: boolean;
  retries: number;
  committed: boolean;
  desiredPaused: boolean;
  automatic: boolean;
}

interface Attempt {
  id: number;
  session: ListeningSession;
  previous: Attempt | null;
  committed: boolean;
  terminal: boolean;
  seekSequence: number;
  pauseSequence: number;
  pendingSeek: boolean;
  enqueued: boolean;
  deferredSeek: number | null;
}

const MAX_RETRIES = 2;
const keyOf = (track: Track) => `${track.source}:${track.id}`;

/** Owns playback policy; the production and in-memory engine adapters cross the same seam. */
export function createPlaybackLifecycle(deps: Dependencies): UseBoundStore<StoreApi<PlayerStore>> {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  let store: UseBoundStore<StoreApi<PlayerStore>>;
  let target: Attempt | null = null;
  let audible: Attempt | null = null;
  const attempts = new Map<number, Attempt>();
  let enginePlaybackId = 0;
  let lastId = 0;
  let queueRevision = 0;
  let refill: object | null = null;
  let disposed = false;
  const failedTracks = new Set<string>();

  // Epoch microseconds leave ample room between reloads, while each instance is monotonic.
  const nextId = () => (lastId = Math.max(lastId + 1, Math.floor(now()) * 1000));
  const error = (prefix: string, cause: unknown) => deps.notify('error', `${prefix}: ${deps.errorMessage(cause)}`);
  const current = (attempt: Attempt) => !disposed && target === attempt && !attempt.terminal;

  function trackTime(session: ListeningSession, state: PlayerState) {
    if (state === 'playing') {
      if (session.startedAt === null) session.startedAt = Math.floor(now() / 1000);
      if (session.playingSince === null) session.playingSince = now();
    } else if (session.playingSince !== null) {
      session.playedMs += Math.max(0, now() - session.playingSince);
      session.playingSince = null;
    }
    session.state = state;
  }

  function finish(session: ListeningSession) {
    trackTime(session, 'stopped');
    if (session.reported) return;
    session.reported = true;
    if (session.startedAt === null || session.playedMs <= 0) return;
    const duration = session.durationMs;
    const played = Math.round(Math.min(session.playedMs, duration > 0 ? duration : session.playedMs));
    const event: PlayEvent = {
      trackId: session.track.id, source: session.track.source,
      artist: session.track.artist, album: session.track.album,
      trackDurationMs: duration, playedDurationMs: played, startedAt: session.startedAt,
      completed: duration > 0 && (played >= duration * 0.8 || played >= duration - 10_000),
    };
    // Telemetry must not stop playback, including an adapter that fails synchronously.
    try { void deps.recordPlayEvent(event).catch(() => {}); } catch { /* best effort */ }
  }

  function accept(attempt: Attempt) {
    if (attempt.committed) return;
    if (audible && audible.session !== attempt.session) finish(audible.session);
    enginePlaybackId = attempt.id;
    attempt.committed = true;
    attempt.session.committed = true;
    attempt.previous = null;
    audible = attempt;
    // An earlier load can already be in the engine when a newer URL request starts.
    // Remember what is actually audible without replacing that newer pending intent.
    if (target && target.id > attempt.id) {
      target.previous = attempt;
    } else if (!target || target.id < attempt.id) {
      target = attempt;
      store.setState({
        currentTrack: attempt.session.track, playbackId: attempt.id,
        state: attempt.session.state, positionMs: attempt.session.positionMs,
        playWhenReady: !attempt.session.desiredPaused,
        durationMs: attempt.session.durationMs, emittedAtMs: 0,
        queueIndex: store.getState().queue.findIndex(track => keyOf(track) === keyOf(attempt.session.track)),
      });
    }
    for (const id of attempts.keys()) { if (id < attempt.id) attempts.delete(id); }
  }

  function shuffled(length: number): number[] {
    const order = Array.from({ length }, (_, index) => index);
    for (let i = length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  function nextIndex(direction: 1 | -1): number {
    const { queue, queueIndex, playMode, shuffleOrder } = store.getState();
    if (!queue.length) return -1;
    if (playMode === 'repeat-one' && queueIndex >= 0) return queueIndex;
    if (playMode === 'shuffle') {
      const offset = shuffleOrder.indexOf(queueIndex);
      return shuffleOrder[(offset + direction + shuffleOrder.length) % shuffleOrder.length] ?? 0;
    }
    return (queueIndex + direction + queue.length) % queue.length;
  }

  function replenish() {
    const state = store.getState();
    if (disposed || refill || !state.queue.length || state.queue.length - state.queueIndex - 1 > 2) return;
    const revision = queueRevision;
    const token = {};
    refill = token;
    void deps.getRadioBatch(state.queue.map(keyOf)).then(result => {
      if (disposed || revision !== queueRevision || refill !== token) return;
      deps.notifyDiscovery(result.discovery);
      store.getState().addToQueue(result.tracks);
    }).catch(() => { /* Keep the current playback when recommendations fail. */ }).finally(() => {
      if (refill === token) refill = null;
    });
  }

  function restorePrevious(attempt: Attempt) {
    const previous = audible && !audible.terminal ? audible : null;
    target = previous;
    if (previous) {
      const session = previous.session;
      store.setState({
        currentTrack: session.track, playbackId: previous.id, state: session.state,
        playWhenReady: !session.desiredPaused,
        positionMs: session.positionMs, durationMs: session.durationMs, emittedAtMs: 0,
        queueIndex: store.getState().queue.findIndex(track => keyOf(track) === keyOf(session.track)),
      });
    } else {
      const track = attempt.previous?.session.track ?? null;
      store.setState({
        currentTrack: track, playbackId: null, state: track ? 'stopped' : 'idle',
        playWhenReady: false,
        positionMs: attempt.previous?.session.positionMs ?? 0, durationMs: track?.durationMs ?? 0,
        queueIndex: track ? store.getState().queue.findIndex(item => keyOf(item) === keyOf(track)) : -1,
        emittedAtMs: 0,
      });
    }
  }

  async function failed(attempt: Attempt, cause: unknown, engineFailure: boolean): Promise<void> {
    if (!current(attempt)) return;
    attempt.terminal = true;
    const session = attempt.session;
    if (engineFailure) { accept(attempt); trackTime(session, 'stopped'); }
    const kind = cause && typeof cause === 'object' && 'kind' in cause ? cause.kind : undefined;
    const retryable = engineFailure || kind === 'network' || kind === 'rate_limited' || kind === 'internal';
    if (retryable && session.retries < MAX_RETRIES) {
      session.retries++;
      deps.notify('info', `播放中断，正在重试… (${session.retries}/${MAX_RETRIES})`);
      await startAttempt(session);
      return;
    }
    error('播放失败', cause);
    if (!session.committed && !session.automatic) {
      restorePrevious(attempt);
      return;
    }
    finish(session);
    if (audible?.session === session) audible = null;
    store.setState({ state: 'stopped', playWhenReady: false, bufferingPercent: 0, emittedAtMs: 0 });
    failedTracks.add(keyOf(session.track));
    const { queue, queueIndex, playMode, shuffleOrder } = store.getState();
    if (playMode === 'repeat-one' || queue.length <= 1) return;
    const order = playMode === 'shuffle' ? shuffleOrder : queue.map((_, index) => index);
    const offset = order.indexOf(queueIndex);
    for (let step = 1; step <= order.length; step++) {
      const index = order[(offset + step + order.length) % order.length];
      if (queue[index] && !failedTracks.has(keyOf(queue[index]))) {
        await select(index, true);
        return;
      }
    }
  }

  async function startAttempt(session: ListeningSession): Promise<void> {
    const attempt: Attempt = {
      id: nextId(), session, previous: audible, committed: false, terminal: false,
      seekSequence: 0, pauseSequence: 0, pendingSeek: false,
      enqueued: false, deferredSeek: null,
    };
    attempts.set(attempt.id, attempt);
    target = attempt;
    const position = session.positionMs;
    const paused = session.desiredPaused;
    store.setState({
      currentTrack: session.track, playbackId: attempt.id, state: 'loading',
      playWhenReady: !session.desiredPaused,
      positionMs: position, durationMs: session.durationMs, emittedAtMs: 0, bufferingPercent: 0,
    });
    if (session.retries === 0) replenish();
    try {
      await deps.engine.playTrack(session.track, attempt.id, position, paused);
      if (!current(attempt)) return;
      attempt.enqueued = true;
      // Commands issued while the URL was being resolved still belong to this attempt.
      if (session.desiredPaused !== paused) await applyPaused(attempt);
      if (current(attempt) && attempt.deferredSeek !== null) {
        await store.getState().seek(attempt.deferredSeek, attempt.id);
      }
    } catch (cause) {
      await failed(attempt, cause, false);
      if (target !== attempt && audible !== attempt) attempts.delete(attempt.id);
    }
  }

  async function select(index: number, automatic = false): Promise<void> {
    if (disposed) return;
    const track = store.getState().queue[index];
    if (!track) return;
    if (!automatic) failedTracks.clear();
    store.setState({ queueIndex: index });
    await startAttempt({
      track, state: 'loading', positionMs: 0, durationMs: track.durationMs,
      startedAt: null, playingSince: null, playedMs: 0, reported: false,
      retries: 0, committed: false, desiredPaused: false, automatic,
    });
  }

  async function applyPaused(attempt: Attempt, owner = attempt): Promise<void> {
    const sequence = ++attempt.pauseSequence;
    try {
      await deps.engine.setPlaybackPaused(attempt.id, attempt.session.desiredPaused);
    } catch (cause) {
      const relevant = current(attempt) || (current(owner) && attempt === audible);
      if (!relevant || attempt.pauseSequence !== sequence) return;
      attempt.session.desiredPaused = attempt.session.state === 'paused';
      if (attempt === target) store.setState({ playWhenReady: !attempt.session.desiredPaused });
      error('操作失败', cause);
    }
  }

  function handlePlaybackEvent(event: PlaybackEvent) {
    if (disposed) return;
    const attempt = attempts.get(event.playbackId);
    if (!attempt || attempt.terminal || event.playbackId < enginePlaybackId) return;
    const session = attempt.session;
    accept(attempt);
    const foreground = target === attempt;
    if (event.type === 'error') {
      if (foreground) void failed(attempt, event.message, true);
      else { attempt.terminal = true; finish(session); if (audible === attempt) audible = null; }
      return;
    }
    switch (event.type) {
      case 'state':
        trackTime(session, event.state);
        if (event.state === 'playing' || event.state === 'paused') session.positionMs = event.positionMs;
        if (foreground) {
          store.setState({ state: event.state, ...(event.state === 'playing' || event.state === 'paused' ? { positionMs: event.positionMs, emittedAtMs: 0 } : {}) });
          if (event.state === 'stopped') store.setState({ playWhenReady: false });
          if (event.state === 'playing') store.setState(state => ({
            recentTracks: [session.track, ...state.recentTracks.filter(track => keyOf(track) !== keyOf(session.track))].slice(0, 10),
          }));
        }
        if (event.state === 'stopped') finish(session);
        break;
      case 'progress':
        if (attempt.pendingSeek) return;
        session.positionMs = event.positionMs;
        if (event.durationMs > 0) session.durationMs = event.durationMs;
        if (foreground) store.setState({ positionMs: session.positionMs, durationMs: session.durationMs, emittedAtMs: event.emittedAtMs });
        break;
      case 'buffering':
        trackTime(session, 'buffering');
        if (foreground) store.setState({ state: 'buffering', bufferingPercent: event.percent, emittedAtMs: 0 });
        break;
      case 'ended':
        attempt.terminal = true;
        finish(session);
        if (audible === attempt) audible = null;
        if (foreground) { failedTracks.clear(); void select(nextIndex(1), true); }
        break;
    }
  }

  async function clearQueue(): Promise<void> {
    const stopId = nextId();
    enginePlaybackId = stopId;
    queueRevision++;
    refill = null;
    if (audible) finish(audible.session);
    if (target && target.session !== audible?.session) finish(target.session);
    target = null;
    audible = null;
    attempts.clear();
    failedTracks.clear();
    store.setState({
      queue: [], queueIndex: -1, shuffleOrder: [], currentTrack: null, playbackId: null,
      state: 'idle', positionMs: 0, durationMs: 0, emittedAtMs: 0, bufferingPercent: 0,
      playWhenReady: false,
    });
    try { await deps.engine.stopPlayback(stopId); }
    catch (cause) { if (!disposed && lastId === stopId) error('停止播放失败', cause); }
  }

  store = create<PlayerStore>((set, get) => ({
    currentTrack: null, playbackId: null, state: 'idle', positionMs: 0, durationMs: 0,
    playWhenReady: false,
    emittedAtMs: 0, volume: 1, bufferingPercent: 0,
    queue: [], queueIndex: -1, playMode: 'sequence', shuffleOrder: [], recentTracks: [],
    handlePlaybackEvent,
    playFromQueue: index => select(index),
    playNext: () => select(nextIndex(1)),
    playPrev: () => select(nextIndex(-1)),
    clearQueue,
    shutdown: () => { if (!disposed) { disposed = true; void clearQueue(); } },
    togglePlayback: async () => {
      if (disposed || !get().currentTrack) return;
      if (!target || target.terminal || get().state === 'stopped') { await select(get().queueIndex); return; }
      const attempt = target;
      attempt.session.desiredPaused = !attempt.session.desiredPaused;
      set({ playWhenReady: !attempt.session.desiredPaused });
      const controls: Promise<void>[] = [];
      if (attempt.committed || attempt.enqueued) controls.push(applyPaused(attempt));
      if (audible && audible !== attempt && !audible.terminal) {
        audible.session.desiredPaused = attempt.session.desiredPaused;
        controls.push(applyPaused(audible, attempt));
      }
      await Promise.all(controls);
    },
    seek: async (position, expectedPlaybackId) => {
      const attempt = target;
      if (!attempt || !current(attempt) || !Number.isFinite(position)) return;
      if (expectedPlaybackId !== undefined && expectedPlaybackId !== attempt.id) return;
      const previous = get().positionMs;
      const value = Math.max(0, Math.min(position, get().durationMs || Number.MAX_SAFE_INTEGER));
      const sequence = ++attempt.seekSequence;
      attempt.session.positionMs = value;
      set({ positionMs: value, emittedAtMs: 0 });
      if (!attempt.committed && !attempt.enqueued) { attempt.deferredSeek = value; return; }
      attempt.deferredSeek = null;
      attempt.pendingSeek = true;
      try { await deps.engine.seek(attempt.id, value); }
      catch (cause) {
        if (current(attempt) && attempt.seekSequence === sequence) {
          attempt.session.positionMs = previous;
          set({ positionMs: previous, emittedAtMs: 0 });
          error('跳转失败', cause);
        }
      } finally {
        if (attempt.seekSequence === sequence) attempt.pendingSeek = false;
      }
    },
    setVolume: volume => {
      if (!Number.isFinite(volume) || disposed) return;
      const value = Math.max(0, Math.min(1, volume));
      set({ volume: value });
      void deps.engine.setVolume(value).catch(cause => error('音量设置失败', cause));
      void deps.saveVolume(value).catch(cause => error('音量保存失败', cause));
    },
    addToQueue: tracks => set(state => {
      const queue = [...state.queue];
      const keys = new Set(queue.map(keyOf));
      for (const track of tracks) { if (!keys.has(keyOf(track))) { queue.push(track); keys.add(keyOf(track)); } }
      const shuffleOrder = state.playMode === 'shuffle'
        ? [...state.shuffleOrder, ...shuffled(queue.length).filter(index => !state.shuffleOrder.includes(index))]
        : state.shuffleOrder;
      return { queue, shuffleOrder };
    }),
    insertNext: track => set(state => {
      const queue = [...state.queue];
      queue.splice(state.queueIndex >= 0 ? state.queueIndex + 1 : queue.length, 0, track);
      return { queue, shuffleOrder: state.playMode === 'shuffle' ? shuffled(queue.length) : [] };
    }),
    removeFromQueue: index => {
      const state = get();
      if (index < 0 || index >= state.queue.length) return;
      if (state.queue.length === 1) { void clearQueue(); return; }
      const queue = state.queue.filter((_, item) => item !== index);
      const queueIndex = index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex;
      set({ queue, queueIndex, shuffleOrder: state.playMode === 'shuffle' ? shuffled(queue.length) : [] });
      if (index === state.queueIndex) void select(index % queue.length);
    },
    setPlayMode: mode => set(state => ({ playMode: mode, shuffleOrder: mode === 'shuffle' ? shuffled(state.queue.length) : [] })),
  }));
  return store;
}
