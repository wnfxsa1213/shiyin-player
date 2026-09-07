// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipc, type RecommendResult } from '@/lib/ipc';
import { useFmStore } from '@/store/fmStore';
import { usePlayerStore, type Track } from '@/store/playerStore';
import { useRecommendStore } from '@/store/recommendStore';
import { useToastStore } from '@/store/toastStore';
import DailyRecommendView from '@/views/DailyRecommendView';

vi.mock('@/lib/ipc', () => ({
  ipc: {
    checkLoginStatus: vi.fn(),
    getSmartRecommend: vi.fn(),
    getRadioBatch: vi.fn(),
    playTrack: vi.fn(),
    stopPlayback: vi.fn(),
    setPlaybackPaused: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    recordPlayEvent: vi.fn(),
  },
}));
vi.mock('@/lib/settings', () => ({ saveSetting: vi.fn().mockResolvedValue(undefined) }));

function track(id: string): Track {
  return { id, name: id, artist: 'artist', album: 'album', durationMs: 180_000, source: 'netease' };
}

function emptyResult(rediscover: Track[] = []): RecommendResult {
  return {
    personalized: [], topArtists: [], rediscover,
    discovery: { outcome: 'empty', availableSources: [], unavailableSources: [] },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  useFmStore.setState(useFmStore.getInitialState(), true);
  useRecommendStore.setState(useRecommendStore.getInitialState(), true);
  vi.mocked(ipc.checkLoginStatus).mockResolvedValue({ netease: true, qqmusic: true });
  vi.mocked(ipc.playTrack).mockResolvedValue(undefined);
  vi.mocked(ipc.stopPlayback).mockResolvedValue(undefined);
  vi.mocked(ipc.setPlaybackPaused).mockResolvedValue(undefined);
  vi.mocked(ipc.seek).mockResolvedValue(undefined);
  vi.mocked(ipc.setVolume).mockResolvedValue(undefined);
  vi.mocked(ipc.recordPlayEvent).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().removeToast(toast.id);
  }
});

describe('每日推荐的空结果恢复', () => {
  it('推荐请求失败后等待用户重试，不自动循环请求', async () => {
    vi.mocked(ipc.getSmartRecommend).mockRejectedValueOnce({ kind: 'network' }).mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><DailyRecommendView /></MemoryRouter>);
    await screen.findByText('推荐歌曲加载失败');
    expect(ipc.getSmartRecommend).toHaveBeenCalledTimes(1);
    vi.mocked(ipc.getSmartRecommend).mockResolvedValue({ ...emptyResult(), personalized: [track('recovered')],
      discovery: { outcome: 'complete', availableSources: ['netease'], unavailableSources: [] } });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('recovered');
    expect(ipc.getSmartRecommend).toHaveBeenCalledTimes(2);
  });

  it('未登录时不展示上次账号的缓存推荐', async () => {
    useRecommendStore.setState({ ...emptyResult(), personalized: [track('cached')],
      discovery: { outcome: 'complete', availableSources: ['netease'], unavailableSources: [] } });
    vi.mocked(ipc.checkLoginStatus).mockResolvedValue({ netease: false, qqmusic: false });
    render(<MemoryRouter><DailyRecommendView /></MemoryRouter>);
    await screen.findByText('登录后查看智能推荐');
    expect(screen.queryByText('cached')).toBeNull();
    expect(ipc.getSmartRecommend).not.toHaveBeenCalled();
  });

  it.each([false, true])('空结果有重温经典=%s 时仍可刷新并获得新歌曲', async (hasRediscover) => {
    const empty = emptyResult(hasRediscover ? [track('old-song')] : []);
    const recovered: RecommendResult = {
      ...emptyResult(), personalized: [track('new-song')],
      discovery: { outcome: 'complete', availableSources: ['netease'], unavailableSources: [] },
    };
    vi.mocked(ipc.getSmartRecommend).mockResolvedValueOnce(empty).mockResolvedValueOnce(recovered);

    const firstVisit = render(<MemoryRouter><DailyRecommendView /></MemoryRouter>);
    await screen.findByText(hasRediscover ? '今天暂无新精选，但可重温经典' : '今日暂无推荐歌曲');
    firstVisit.unmount();
    render(<MemoryRouter><DailyRecommendView /></MemoryRouter>);
    await screen.findByText(hasRediscover ? '今天暂无新精选，但可重温经典' : '今日暂无推荐歌曲');

    fireEvent.click(screen.getByRole('button', { name: '刷新推荐' }));
    await screen.findByText('new-song');
    expect(ipc.getSmartRecommend).toHaveBeenCalledTimes(2);
  });

  it('没有可用歌曲且音源失败时展示重试入口', async () => {
    vi.mocked(ipc.getSmartRecommend).mockResolvedValue({
      ...emptyResult(),
      discovery: { outcome: 'unavailable', availableSources: [], unavailableSources: ['qqmusic'] },
    });
    render(<MemoryRouter><DailyRecommendView /></MemoryRouter>);

    await screen.findByText('暂时无法获取推荐，请稍后重试');
    expect(screen.queryByText('今日暂无推荐歌曲')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(ipc.getSmartRecommend).toHaveBeenCalledTimes(2));
  });
});

describe('电台降级通知', () => {
  it('FM 播放和自动补曲共享去重，音源恢复后再次失败可以重新提示', async () => {
    const songs = ['one', 'two', 'three'].map(track);
    vi.mocked(ipc.getRadioBatch).mockImplementation(async (excluded) => ({
      tracks: songs.filter(song => !excluded.includes(`${song.source}:${song.id}`)),
      discovery: { outcome: 'degraded', availableSources: ['netease'], unavailableSources: ['qqmusic'] },
    }));
    const notices = () => useToastStore.getState().toasts.filter(toast => toast.message.includes('部分音源暂不可用'));

    await act(async () => { await useFmStore.getState().playNext(); });
    await waitFor(() => expect(ipc.getRadioBatch).toHaveBeenCalledTimes(2));
    expect(notices()).toHaveLength(1);

    for (const outcome of ['complete', 'empty'] as const) {
      vi.mocked(ipc.getRadioBatch).mockResolvedValueOnce({
        tracks: [], discovery: { outcome, availableSources: [], unavailableSources: [] },
      });
      await useFmStore.getState().fetchMore();
      vi.mocked(ipc.getRadioBatch).mockResolvedValueOnce({
        tracks: [track('recovered')],
        discovery: { outcome: 'degraded', availableSources: ['netease'], unavailableSources: ['qqmusic'] },
      });
      await useFmStore.getState().fetchMore();
    }
    expect(notices()).toHaveLength(3);
  });
});
