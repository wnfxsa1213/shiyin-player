import { describe, expect, it, vi } from 'vitest';
import { createPlaybackLifecycle, type PlaybackEngine, type PlaybackEvent, type Track } from '@/lib/playbackLifecycle';
import type { PlayEvent, RadioBatchResult } from '@/lib/ipc';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const track = (id: string): Track => ({ id, name: id, source: 'netease', artist: id, album: 'album', durationMs: 100_000 });
const empty = (): RadioBatchResult => ({ tracks: [], discovery: { outcome: 'empty', availableSources: [], unavailableSources: [] } });
function fixture() {
  let time = 1_700_000_000_000;
  const engine = {
    playTrack: vi.fn<PlaybackEngine['playTrack']>().mockResolvedValue(undefined),
    setPlaybackPaused: vi.fn<PlaybackEngine['setPlaybackPaused']>().mockResolvedValue(undefined),
    seek: vi.fn<PlaybackEngine['seek']>().mockResolvedValue(undefined),
    stopPlayback: vi.fn<PlaybackEngine['stopPlayback']>().mockResolvedValue(undefined),
    setVolume: vi.fn<PlaybackEngine['setVolume']>().mockResolvedValue(undefined),
  };
  const record = vi.fn<(event: PlayEvent) => Promise<void>>().mockResolvedValue(undefined);
  const radio = vi.fn<(keys: string[]) => Promise<RadioBatchResult>>().mockResolvedValue(empty());
  const notify = vi.fn();
  const notifyDiscovery = vi.fn();
  const store = createPlaybackLifecycle({
    engine, recordPlayEvent: record, getRadioBatch: radio, notify, notifyDiscovery,
    errorMessage: cause => typeof cause === 'object' && cause && 'message' in cause ? String(cause.message) : String(cause),
    saveVolume: vi.fn().mockResolvedValue(undefined), now: () => time, random: () => 0.5,
  });
  const emit = (event: PlaybackEvent) => store.getState().handlePlaybackEvent(event);
  const state = (id: number, value: 'loading' | 'playing' | 'paused' | 'stopped', positionMs = 0) => emit({ type: 'state', playbackId: id, state: value, positionMs });
  const progress = (id: number, positionMs: number) => emit({ type: 'progress', playbackId: id, positionMs, durationMs: 100_000, emittedAtMs: time });
  const play = async (index = 0) => {
    await store.getState().playFromQueue(index);
    const id = store.getState().playbackId!;
    state(id, 'loading'); state(id, 'playing'); return id;
  };
  return { store, engine, record, radio, notify, notifyDiscovery, emit, state, progress, play, tick: (ms: number) => { time += ms; } };
}

describe('可消费的实际播放事实', () => {
  it('首次实际 Playing 才给出逻辑身份，暂停、缓冲与重试保持身份', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A')]);
    await f.store.getState().playFromQueue(0);
    const attempt = f.store.getState().playbackId!;
    expect(f.store.getState().listening.sessionId).toBeNull();
    f.state(attempt, 'loading'); expect(f.store.getState().listening.sessionId).toBeNull();
    f.state(attempt, 'playing'); const session = f.store.getState().listening.sessionId;
    expect(session).not.toBeNull();
    f.state(attempt, 'paused'); expect(f.store.getState().listening).toMatchObject({ sessionId: session, state: 'paused' });
    f.state(attempt, 'playing'); f.emit({ type: 'buffering', playbackId: attempt, percent: 10 });
    expect(f.store.getState().listening).toMatchObject({ sessionId: session, state: 'buffering' });
    f.state(attempt, 'playing'); f.emit({ type: 'error', playbackId: attempt, message: 'retry' });
    const retry = f.store.getState().playbackId!; expect(retry).not.toBe(attempt);
    f.state(retry, 'playing'); expect(f.store.getState().listening).toMatchObject({ sessionId: session, playbackId: retry, state: 'playing' });
    const stable = f.store.getState().listening; f.progress(retry, 1000); expect(f.store.getState().listening).toBe(stable);
  });
  it('加载意图不冒充实际曲目，单曲循环重开产生新身份，清队列清理事实', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]);
    const first = await f.play(); const session = f.store.getState().listening.sessionId;
    await f.store.getState().playFromQueue(1);
    expect(f.store.getState().currentTrack?.id).toBe('B');
    expect(f.store.getState().listening.track?.id).toBe('A');
    const next = f.store.getState().playbackId!; f.state(next, 'playing');
    const second = f.store.getState().listening.sessionId; expect(second).not.toBe(session);
    f.state(first, 'playing'); expect(f.store.getState().listening.sessionId).toBe(second);
    f.store.getState().setPlayMode('repeat-one'); f.emit({ type: 'ended', playbackId: next });
    f.state(f.store.getState().playbackId!, 'playing'); expect(f.store.getState().listening.sessionId).not.toBe(second);
    await f.store.getState().clearQueue(); expect(f.store.getState().listening).toEqual({ sessionId: null, playbackId: null, track: null, state: 'idle' });
  });
});

describe('请求与后端事件', () => {
  it('快速切歌后忽略旧请求失败和全部旧事件', async () => {
    const f = fixture(), pending = deferred<void>();
    f.engine.playTrack.mockReturnValueOnce(pending.promise);
    f.store.getState().addToQueue([track('A'), track('B')]);
    const request = f.store.getState().playFromQueue(0), oldId = f.store.getState().playbackId!;
    const id = await f.play(1);
    pending.reject({ kind: 'unauthorized', message: 'expired A' }); await request;
    f.state(oldId, 'playing'); f.progress(oldId, 80_000);
    f.emit({ type: 'buffering', playbackId: oldId, percent: 10 });
    f.emit({ type: 'error', playbackId: oldId, message: 'late A' });
    f.emit({ type: 'ended', playbackId: oldId });
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'B' }, playbackId: id, state: 'playing', positionMs: 0 });
    expect(f.engine.playTrack).toHaveBeenCalledTimes(2);
    expect(f.record).not.toHaveBeenCalled(); expect(f.notify).not.toHaveBeenCalled();
  });

  it('新地址失败时恢复上一首，保留等待期间的实际计时', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]);
    const id = await f.play(); f.tick(1000);
    const pending = deferred<void>(); f.engine.playTrack.mockReturnValueOnce(pending.promise);
    const request = f.store.getState().playFromQueue(1);
    f.tick(3000); f.progress(id, 4000);
    pending.reject({ kind: 'unauthorized', message: 'denied' }); await request;
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'A' }, playbackId: id, state: 'playing', positionMs: 4000 });
    f.tick(1000); f.store.getState().shutdown();
    expect(f.record).toHaveBeenCalledTimes(1);
    expect(f.record.mock.calls[0][0]).toMatchObject({ trackId: 'A', playedDurationMs: 5000 });
    expect(f.store.getState().recentTracks.map(item => item.id)).toEqual(['A']);
  });

  it('普通停止不切歌，独立结束事件仅推进一次', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]);
    const id = await f.play(); f.tick(1000); f.state(id, 'stopped');
    expect(f.engine.playTrack).toHaveBeenCalledTimes(1);
    f.emit({ type: 'ended', playbackId: id }); f.emit({ type: 'ended', playbackId: id }); f.state(id, 'stopped');
    expect(f.engine.playTrack).toHaveBeenCalledTimes(2);
    expect(f.store.getState().currentTrack?.id).toBe('B'); expect(f.record).toHaveBeenCalledTimes(1);
  });

  it.each(['before', 'after'])('引擎接管事件在新请求失败的 %s 到达时，回滚仍对应真实曲目', async ordering => {
    const f = fixture();
    f.store.getState().addToQueue([track('A'), track('B'), track('C')]);
    await f.play();
    f.tick(1000);
    await f.store.getState().playFromQueue(1);
    const middleId = f.store.getState().playbackId!;
    const pending = deferred<void>();
    f.engine.playTrack.mockReturnValueOnce(pending.promise);
    const request = f.store.getState().playFromQueue(2);
    f.tick(1000);
    const middleStarts = () => { f.state(middleId, 'loading'); f.state(middleId, 'playing', 4000); };
    if (ordering === 'before') {
      middleStarts();
      expect(f.store.getState().currentTrack?.id).toBe('C');
    }
    pending.reject({ kind: 'unauthorized', message: 'C failed' });
    await request;
    if (ordering === 'after') middleStarts();
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'B' }, playbackId: middleId, state: 'playing', positionMs: 4000 });
    f.tick(1000);
    f.store.getState().shutdown();
    expect(f.record.mock.calls.map(call => call[0].trackId)).toEqual(['A', 'B']);
  });

  it.each(['next', 'previous', 'ended'])('单曲循环以重新加载处理 %s', async action => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]);
    f.store.getState().setPlayMode('repeat-one'); const id = await f.play();
    if (action === 'next') await f.store.getState().playNext();
    else if (action === 'previous') await f.store.getState().playPrev();
    else f.emit({ type: 'ended', playbackId: id });
    expect(f.engine.playTrack).toHaveBeenCalledTimes(2);
    expect(f.engine.playTrack.mock.calls[1]).toEqual([track('A'), expect.any(Number), 0, false]);
    expect(f.engine.seek).not.toHaveBeenCalled(); expect(f.engine.setPlaybackPaused).not.toHaveBeenCalled();
  });
});

describe('重试与控制', () => {
  it('最多重试两次，Playing 不重置预算，恢复位置随加载传入', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A')]); let id = await f.play();
    for (let i = 0; i < 3; i++) {
      f.tick(1000); f.progress(id, 40_000); const previous = id;
      f.emit({ type: 'error', playbackId: previous, message: 'stream failed' }); f.state(previous, 'stopped');
      id = f.store.getState().playbackId!; if (i < 2) f.state(id, 'playing', 40_000);
    }
    expect(f.engine.playTrack).toHaveBeenCalledTimes(3);
    expect(f.engine.playTrack.mock.calls.slice(1).map(call => [call[2], call[3]])).toEqual([[40_000, false], [40_000, false]]);
    expect(f.engine.seek).not.toHaveBeenCalled(); expect(f.store.getState().state).toBe('stopped');
    expect(f.record).toHaveBeenCalledTimes(1); expect(f.record.mock.calls[0][0].playedDurationMs).toBe(3000);
  });

  it('重试完成前切歌，不把旧恢复进度应用到新歌曲', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]); const id = await f.play(); f.progress(id, 45_000);
    const pending = deferred<void>(); f.engine.playTrack.mockReturnValueOnce(pending.promise);
    f.emit({ type: 'error', playbackId: id, message: 'retry A' }); const retryId = f.store.getState().playbackId!;
    const newer = await f.play(1); pending.resolve(); await Promise.resolve(); f.state(retryId, 'playing', 45_000);
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'B' }, playbackId: newer, positionMs: 0 });
    expect(f.engine.seek).not.toHaveBeenCalled();
  });

  it('清空队列阻止迟到加载、事件和补曲', async () => {
    const f = fixture(), load = deferred<void>(), radio = deferred<RadioBatchResult>();
    f.engine.playTrack.mockReturnValueOnce(load.promise); f.radio.mockReturnValueOnce(radio.promise);
    f.store.getState().addToQueue([track('A')]); const request = f.store.getState().playFromQueue(0), id = f.store.getState().playbackId!;
    await f.store.getState().clearQueue(); load.resolve(); radio.resolve({ ...empty(), tracks: [track('late')] }); await request;
    f.state(id, 'playing'); f.emit({ type: 'ended', playbackId: id });
    expect(f.store.getState()).toMatchObject({ queue: [], currentTrack: null, state: 'idle' });
    expect(f.engine.stopPlayback.mock.calls[0][0]).toBeGreaterThan(id);
    expect(f.engine.playTrack).toHaveBeenCalledTimes(1); expect(f.record).not.toHaveBeenCalled();
  });

  it('URL 加载期间的暂停和跳转在就绪后生效', async () => {
    const f = fixture(), load = deferred<void>(); f.engine.playTrack.mockReturnValueOnce(load.promise);
    f.store.getState().addToQueue([track('A')]); const request = f.store.getState().playFromQueue(0), id = f.store.getState().playbackId!;
    await f.store.getState().togglePlayback(); await f.store.getState().seek(20_000); load.resolve(); await request;
    expect(f.engine.setPlaybackPaused).toHaveBeenCalledWith(id, true); expect(f.engine.seek).toHaveBeenCalledWith(id, 20_000);
  });

  it('切歌加载期间暂停会立即暂停旧曲目，失败回滚后仍保持暂停', async () => {
    const f = fixture();
    f.store.getState().addToQueue([track('A'), track('B')]);
    const id = await f.play();
    const pending = deferred<void>();
    f.engine.playTrack.mockReturnValueOnce(pending.promise);
    const request = f.store.getState().playFromQueue(1);
    await f.store.getState().togglePlayback();
    expect(f.engine.setPlaybackPaused).toHaveBeenCalledWith(id, true);
    f.state(id, 'paused', 1000);
    pending.reject({ kind: 'unauthorized', message: 'B failed' });
    await request;
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'A' }, state: 'paused', playWhenReady: false });
    await f.store.getState().togglePlayback();
    expect(f.engine.setPlaybackPaused).toHaveBeenLastCalledWith(id, false);
  });

  it.each(['before', 'after'])('迟到接管在回滚 %s 到达时仍执行用户的暂停意图', async ordering => {
    const f = fixture();
    f.store.getState().addToQueue(['A', 'B', 'C', 'D'].map(track));
    const oldId = await f.play();
    await f.store.getState().playFromQueue(1);
    const middleId = f.store.getState().playbackId!;
    const pending = deferred<void>();
    f.engine.playTrack.mockReturnValueOnce(pending.promise);
    const selection = f.store.getState().playFromQueue(2);
    await f.store.getState().togglePlayback();
    f.state(oldId, 'paused');
    const middleStarts = () => { f.state(middleId, 'loading'); f.state(middleId, 'playing'); };
    if (ordering === 'before') middleStarts();
    pending.reject({ kind: 'unauthorized', message: 'C failed' });
    await selection;
    if (ordering === 'after') middleStarts();

    expect(f.engine.setPlaybackPaused).toHaveBeenCalledWith(middleId, true);
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'B' }, playbackId: middleId, playWhenReady: false });
    f.state(middleId, 'paused');
    await f.store.getState().togglePlayback();
    expect(f.engine.setPlaybackPaused).toHaveBeenLastCalledWith(middleId, false);
    await f.store.getState().togglePlayback();
    // A later explicit song selection starts normally; the earlier pause only owns in-flight loads.
    const newId = await f.play(3);
    expect(f.store.getState().playWhenReady).toBe(true);
    expect(f.engine.setPlaybackPaused).not.toHaveBeenCalledWith(newId, true);
  });

  it('拒绝旧拖动，旧 seek 失败不回滚新歌曲', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]); const id = await f.play();
    const seek = deferred<void>(); f.engine.seek.mockReturnValueOnce(seek.promise); const request = f.store.getState().seek(20_000);
    const newer = await f.play(1); seek.reject({ message: 'late seek' }); await request; await f.store.getState().seek(30_000, id);
    expect(f.engine.seek).toHaveBeenCalledTimes(1); expect(f.store.getState()).toMatchObject({ playbackId: newer, positionMs: 0 });
    expect(f.notify).not.toHaveBeenCalled();
  });

  it('当前 seek 失败恢复进度并提示', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A')]); const id = await f.play(); f.progress(id, 4000);
    f.engine.seek.mockRejectedValueOnce({ message: 'not seekable' }); await f.store.getState().seek(30_000);
    expect(f.store.getState().positionMs).toBe(4000); expect(f.notify).toHaveBeenCalledWith('error', '跳转失败: not seekable');
  });

  it('暂停失败时按钮恢复真实播放意图', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A')]); await f.play();
    f.engine.setPlaybackPaused.mockRejectedValueOnce({ message: 'pause failed' });
    await f.store.getState().togglePlayback();
    expect(f.store.getState()).toMatchObject({ state: 'playing', playWhenReady: true });
    expect(f.notify).toHaveBeenCalledWith('error', '操作失败: pause failed');
  });

  it('回滚到旧曲目后，其未完成的暂停失败仍会恢复按钮状态', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]); await f.play();
    const loading = deferred<void>(), pausing = deferred<void>();
    f.engine.playTrack.mockReturnValueOnce(loading.promise);
    f.engine.setPlaybackPaused.mockReturnValueOnce(pausing.promise);
    const selection = f.store.getState().playFromQueue(1);
    const pause = f.store.getState().togglePlayback();
    loading.reject({ kind: 'unauthorized', message: 'B failed' }); await selection;
    pausing.reject({ message: 'pause failed' }); await pause;
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'A' }, state: 'playing', playWhenReady: true });
  });

  it('整条队列无法播放时停止，避免无限失败循环', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B'), track('C')]); const id = await f.play();
    f.engine.playTrack.mockRejectedValue({ kind: 'network', message: 'offline' }); f.emit({ type: 'error', playbackId: id, message: 'offline' });
    await vi.waitFor(() => expect(f.store.getState().state).toBe('stopped'));
    expect(f.engine.playTrack).toHaveBeenCalledTimes(9); expect(f.store.getState().currentTrack?.id).toBe('C');
  });

  it.each(['sequence', 'shuffle'] as const)('%s 模式下迟到补曲不扩大失败轮次，手动播放可恢复补曲', async mode => {
    const f = fixture(), pendingBatch = deferred<RadioBatchResult>();
    let batch = 0;
    f.radio.mockImplementation(async () => ({
      ...empty(), tracks: [track(`extra-${++batch}`)],
    })).mockReturnValueOnce(pendingBatch.promise);
    f.store.getState().addToQueue(['A', 'B', 'C'].map(track));
    f.store.getState().setPlayMode(mode);
    const id = await f.play();
    f.engine.playTrack.mockImplementation(async () => {
      // Bound the broken implementation so an endless microtask loop cannot hang the suite.
      if (f.engine.playTrack.mock.calls.length > 18) return new Promise<void>(() => {});
      throw { kind: 'network', message: 'stream server unavailable' };
    });
    f.emit({ type: 'error', playbackId: id, message: 'stream server unavailable' });
    pendingBatch.resolve({ ...empty(), tracks: [track('late-refill')] });
    await vi.waitFor(() => expect(f.store.getState().state).toBe('stopped'));

    expect(f.store.getState().queue.map(item => item.id)).toContain('late-refill');
    expect(f.engine.playTrack.mock.calls.map(([song]) => song.id).sort()).toEqual(['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C']);
    expect(f.radio).toHaveBeenCalledTimes(1);
    f.engine.playTrack.mockResolvedValue(undefined);
    await f.play(3);
    expect(f.store.getState().state).toBe('playing');
    expect(f.radio).toHaveBeenCalledTimes(2);
  });
});

describe('行为与队列', () => {
  it('播放单曲保留队列、去重，当前歌曲恢复暂停而不重新加载', async () => {
    const f = fixture(); f.store.getState().addToQueue(['A', 'B'].map(track));
    const id = await f.play();
    await f.store.getState().playTrack(track('A'));
    expect(f.engine.playTrack).toHaveBeenCalledTimes(1);
    await f.store.getState().togglePlayback(); f.state(id, 'paused');
    await f.store.getState().playTrack(track('A'));
    expect(f.engine.setPlaybackPaused).toHaveBeenLastCalledWith(id, false);
    expect(f.engine.playTrack).toHaveBeenCalledTimes(1);
    await f.store.getState().playTrack(track('C'));
    expect(f.store.getState().queue.map(item => item.id)).toEqual(['A', 'B', 'C']);
    await f.store.getState().playTrack(track('B'));
    expect(f.store.getState().queue.map(item => item.id)).toEqual(['A', 'B', 'C']);
    expect(f.store.getState().currentTrack?.id).toBe('B');
  });

  it('播放全部立即替换队列，迟到停止结果不覆盖后一次选择', async () => {
    const f = fixture(), stop = deferred<void>();
    f.store.getState().addToQueue([track('old')]); await f.play();
    f.engine.stopPlayback.mockReturnValueOnce(stop.promise);
    f.store.getState().setPlayMode('repeat-one');
    const first = f.store.getState().playAll(['A', 'B', 'A'].map(track));
    expect(f.store.getState()).toMatchObject({ playMode: 'sequence', currentTrack: { id: 'A' } });
    expect(f.store.getState().queue.map(item => item.id)).toEqual(['A', 'B']);
    await f.store.getState().playAll(['C', 'D'].map(track), 'shuffle');
    const selected = f.store.getState().playbackId;
    stop.resolve(); await first;
    expect(f.store.getState()).toMatchObject({ playMode: 'shuffle', playbackId: selected });
    expect(f.store.getState().queue.map(item => item.id)).toEqual(['C', 'D']);
    await f.store.getState().playAll([]);
    expect(f.store.getState().playbackId).toBe(selected);
  });

  it.each(['sequence', 'shuffle', 'repeat-one'] as const)('%s 中指定下一首优先一次，移动已有项不重复也不改变当前曲目', async mode => {
    const f = fixture(); f.store.getState().addToQueue(['A', 'B', 'C', 'D'].map(track));
    f.store.getState().setPlayMode(mode); const id = await f.play(2);
    expect(f.store.getState().insertNext(track('A'))).toBe(true);
    expect(f.store.getState().queue.map(item => item.id)).toEqual(['B', 'C', 'A', 'D']);
    expect(f.store.getState()).toMatchObject({ queueIndex: 1, currentTrack: { id: 'C' } });
    f.emit({ type: 'ended', playbackId: id });
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'A' }, nextQueuedKey: null, playMode: mode });
    const next = f.store.getState().playbackId!; f.state(next, 'playing');
    f.emit({ type: 'ended', playbackId: next });
    expect(f.store.getState().currentTrack?.id).toBe(mode === 'repeat-one' ? 'A' : 'D');
  });

  it('空队列可以先安排下一首再按播放，删除指定项不会留下下一首指针', async () => {
    const f = fixture();
    f.store.getState().insertNext(track('A'));
    await f.store.getState().togglePlayback();
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'A' }, nextQueuedKey: null });
    expect(f.store.getState().insertNext(track('A'))).toBe(false);
    f.store.getState().insertNext(track('B'));
    f.store.getState().removeFromQueue(1);
    expect(f.store.getState().nextQueuedKey).toBeNull();
  });

  it('首次加载失败保留恢复入口，重试原歌曲后清除失败事实', async () => {
    const f = fixture(); f.engine.playTrack.mockRejectedValueOnce({ kind: 'unauthorized', message: '请登录' });
    await f.store.getState().playTrack(track('A'));
    expect(f.store.getState()).toMatchObject({ currentTrack: null, playbackFailure: { track: { id: 'A' }, message: '请登录' } });
    await f.store.getState().retryPlayback();
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'A' }, playbackFailure: null, retryCount: 0 });
    expect(f.engine.playTrack).toHaveBeenCalledTimes(2);
    expect(f.store.getState().queue).toHaveLength(1);
  });

  it('同一首的新加载失败回滚后，明确重试仍会创建新尝试', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A')]);
    const previous = await f.play();
    f.engine.playTrack.mockRejectedValueOnce({ kind: 'not_found', message: '暂不可用' });
    await f.store.getState().playNext();
    expect(f.store.getState()).toMatchObject({ playbackId: previous, playbackFailure: { track: { id: 'A' } } });
    await f.store.getState().retryPlayback();
    expect(f.engine.playTrack).toHaveBeenCalledTimes(3);
    expect(f.store.getState().playbackId).not.toBe(previous);
  });

  it('失败回滚后仍指向失败歌曲，自动重试耗尽后可手动开始新一轮', async () => {
    const f = fixture(); f.store.getState().addToQueue(['A', 'B'].map(track)); await f.play();
    f.engine.playTrack.mockRejectedValueOnce({ kind: 'not_found', message: 'B 不可用' });
    await f.store.getState().playTrack(track('B'));
    expect(f.store.getState()).toMatchObject({ currentTrack: { id: 'A' }, playbackFailure: { track: { id: 'B' } } });
    f.store.getState().setPlayMode('repeat-one');
    await f.store.getState().retryPlayback();
    f.state(f.store.getState().playbackId!, 'playing');
    for (let attempt = 0; attempt < 3; attempt++) {
      f.emit({ type: 'error', playbackId: f.store.getState().playbackId!, message: 'offline' });
      if (attempt < 2) {
        expect(f.store.getState().retryCount).toBe(attempt + 1);
        f.state(f.store.getState().playbackId!, 'playing');
      }
    }
    expect(f.store.getState()).toMatchObject({ state: 'stopped', playbackFailure: { track: { id: 'B' } } });
    await f.store.getState().retryPlayback();
    expect(f.store.getState()).toMatchObject({ state: 'loading', retryCount: 0, playbackFailure: null });
    await f.store.getState().clearQueue();
    expect(f.store.getState().playbackFailure).toBeNull();
  });

  it('重复 Playing、暂停和缓冲正确计时，关闭只结算一次', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A')]); const id = await f.play();
    f.tick(2000); f.state(id, 'playing'); f.tick(3000); f.state(id, 'paused'); f.tick(7000); f.state(id, 'playing');
    f.tick(1000); f.emit({ type: 'buffering', playbackId: id, percent: 30 }); f.tick(8000); f.state(id, 'playing');
    f.tick(2000); f.store.getState().shutdown(); f.store.getState().shutdown();
    expect(f.record).toHaveBeenCalledTimes(1); expect(f.record.mock.calls[0][0]).toMatchObject({ trackId: 'A', playedDurationMs: 8000, completed: false });
    expect(f.engine.stopPlayback).toHaveBeenCalledTimes(1);
  });

  it('切歌、结束和清空保留完播规则且不重复结算', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]); await f.play(); f.tick(80_000);
    const id = await f.play(1); f.tick(1000); f.state(id, 'stopped'); f.emit({ type: 'ended', playbackId: id }); await f.store.getState().clearQueue();
    expect(f.record.mock.calls.map(call => [call[0].trackId, call[0].playedDurationMs, call[0].completed])).toEqual([['A', 80_000, true], ['B', 1000, false]]);
  });

  it('旧补曲不能写入替换后的队列，新队列仍能补充', async () => {
    const f = fixture(), oldBatch = deferred<RadioBatchResult>(), newBatch = deferred<RadioBatchResult>();
    f.radio.mockReturnValueOnce(oldBatch.promise).mockReturnValueOnce(newBatch.promise);
    f.store.getState().addToQueue([track('A')]); await f.play(); await f.store.getState().clearQueue();
    f.store.getState().addToQueue([track('B')]); await f.play(); oldBatch.resolve({ ...empty(), tracks: [track('old-extra')] }); await Promise.resolve();
    newBatch.resolve({ ...empty(), tracks: [track('new-extra')] }); await vi.waitFor(() => expect(f.store.getState().queue).toHaveLength(2));
    expect(f.store.getState().queue.map(item => item.id)).toEqual(['B', 'new-extra']); expect(f.notifyDiscovery).toHaveBeenCalledTimes(1);
  });

  it('删除当前曲目播放剩余曲目，删除最后一首停止音频', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]); await f.play();
    f.store.getState().removeFromQueue(0); expect(f.store.getState().currentTrack?.id).toBe('B');
    f.store.getState().removeFromQueue(0); expect(f.engine.stopPlayback).toHaveBeenCalledTimes(1);
    expect(f.store.getState()).toMatchObject({ queue: [], currentTrack: null, state: 'idle' });
  });

  it('随机模式在补曲、删除后仍选择有效曲目', async () => {
    const f = fixture(); f.store.getState().addToQueue([track('A'), track('B')]); f.store.getState().setPlayMode('shuffle'); await f.play();
    f.store.getState().addToQueue([track('C')]); expect([...f.store.getState().shuffleOrder].sort()).toEqual([0, 1, 2]);
    await f.store.getState().playNext(); f.store.getState().removeFromQueue(0); await f.store.getState().playPrev();
    expect(f.store.getState().currentTrack).not.toBeNull(); expect(f.store.getState().queueIndex).toBeGreaterThanOrEqual(0);
  });
});
