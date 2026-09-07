// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ipc, type RecommendResult, type PlaylistBrief } from '@/lib/ipc';
import { usePlayerStore, type Track } from '@/store/playerStore';
import { usePlaylistStore } from '@/store/playlistStore';
import { useRecommendStore } from '@/store/recommendStore';
import { useUiStore } from '@/store/uiStore';
import HomeView from '@/views/HomeView';
import Sidebar from '@/components/layout/Sidebar';

vi.mock('@/lib/ipc', () => ({ ipc: {
  checkLoginStatus: vi.fn(), getSmartRecommend: vi.fn(), getUserPlaylists: vi.fn(),
  playTrack: vi.fn(), stopPlayback: vi.fn(), recordPlayEvent: vi.fn(), getRadioBatch: vi.fn(),
} }));
vi.mock('@/lib/settings', () => ({ saveSetting: vi.fn().mockResolvedValue(undefined) }));
const song = (id: string): Track => ({ id, name: id, artist: '歌手', album: '专辑', durationMs: 180000, source: 'netease' });
const playlists: PlaylistBrief[] = Array.from({ length: 8 }, (_, index) => ({ id: String(index), name: `歌单${index}`, source: 'netease', trackCount: 10 }));
const result = (tracks: Track[] = []): RecommendResult => ({ personalized: tracks, rediscover: [], topArtists: [],
  discovery: { outcome: tracks.length ? 'complete' : 'empty', availableSources: ['netease'], unavailableSources: [] } });
function Location() { return <output aria-label="当前位置">{useLocation().pathname}</output>; }
function show() { return render(<MemoryRouter><Sidebar /><HomeView /><Location /></MemoryRouter>); }
const originalScroll = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  vi.resetAllMocks();
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  usePlaylistStore.setState(usePlaylistStore.getInitialState(), true);
  useRecommendStore.setState(useRecommendStore.getInitialState(), true);
  useUiStore.setState(useUiStore.getInitialState(), true);
  vi.mocked(ipc.checkLoginStatus).mockResolvedValue({ netease: true, qqmusic: false });
  vi.mocked(ipc.getSmartRecommend).mockResolvedValue(result([song('真实推荐')]));
  vi.mocked(ipc.getUserPlaylists).mockResolvedValue(playlists);
  vi.mocked(ipc.playTrack).mockResolvedValue(undefined);
  vi.mocked(ipc.stopPlayback).mockResolvedValue(undefined);
  vi.mocked(ipc.recordPlayEvent).mockResolvedValue(undefined);
  vi.mocked(ipc.getRadioBatch).mockResolvedValue({ tracks: [], discovery: result().discovery });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  cleanup(); await usePlayerStore.getState().clearQueue();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); HTMLElement.prototype.scrollIntoView = originalScroll;
});

it('歌单入口聚焦整个集合，展开所有歌单，只有具体卡片进入详情', async () => {
  usePlaylistStore.setState({ playlists }); show(); await screen.findByText('真实推荐');
  const section = screen.getByRole('region', { name: '我的歌单' });
  fireEvent.click(screen.getByRole('button', { name: /^我的歌单/ }));
  expect(document.activeElement).toBe(within(section).getByRole('heading'));
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  expect(screen.getByLabelText('当前位置').textContent).toBe('/');
  expect(within(section).getAllByRole('link')).toHaveLength(6);
  fireEvent.click(within(section).getByRole('button', { name: '查看全部 8 个歌单' }));
  fireEvent.click(within(section).getByRole('link', { name: '打开歌单：歌单7' }));
  expect(screen.getByLabelText('当前位置').textContent).toBe('/playlist/netease/7');
  expect(ipc.playTrack).not.toHaveBeenCalled();
});

it('推荐展示真实推荐数据，歌单不伪装成推荐，导航与目标命名对应', async () => {
  usePlaylistStore.setState({ playlists }); show(); await screen.findByText('真实推荐');
  const section = screen.getByRole('region', { name: '智能推荐' });
  expect(within(section).queryByText('歌单0')).toBeNull();
  expect(within(section).getByRole('button', { name: '播放：真实推荐，歌手' })).toBeTruthy();
  const navigation = screen.getByRole('navigation', { name: '主导航' });
  fireEvent.click(within(navigation).getByRole('link', { name: '智能推荐' }));
  expect(screen.getByLabelText('当前位置').textContent).toBe('/daily');
  fireEvent.click(screen.getByRole('link', { name: /^搜索音乐/ }));
  expect(screen.getByLabelText('当前位置').textContent).toBe('/search');
  expect(screen.queryByText('我的收藏')).toBeNull(); expect(screen.queryByText('沉浸 FM')).toBeNull(); expect(screen.queryByText('电台')).toBeNull();
});

it('首页及折叠侧栏的播放详情只打开现有播放视图，不开始电台或改动队列', async () => {
  usePlayerStore.getState().addToQueue([song('队列')]); show(); await screen.findByText('真实推荐');
  fireEvent.click(screen.getByRole('button', { name: /^播放详情 查看/ }));
  expect(useUiStore.getState().immersiveOpen).toBe(true);
  act(() => useUiStore.setState({ immersiveOpen: false, sidebarCollapsed: true }));
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '播放详情' }));
  expect(useUiStore.getState().immersiveOpen).toBe(true);
  expect(usePlayerStore.getState().queue.map(track => track.id)).toEqual(['队列']);
  expect(ipc.playTrack).not.toHaveBeenCalled(); expect(ipc.getRadioBatch).not.toHaveBeenCalled();
});

it('未登录显示登录入口，隐藏缓存推荐，不发推荐请求；继续收听仍保留队列', async () => {
  vi.mocked(ipc.checkLoginStatus).mockResolvedValue({ netease: false, qqmusic: false });
  useRecommendStore.setState(result([song('缓存推荐')]));
  usePlayerStore.setState({ recentTracks: [song('历史歌曲')] });
  usePlayerStore.getState().addToQueue([song('队列')]); show(); await screen.findByText('登录后同步你的歌单');
  expect(screen.queryByText('缓存推荐')).toBeNull(); expect(ipc.getSmartRecommend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '播放：历史歌曲，歌手' }));
  await waitFor(() => expect(ipc.playTrack).toHaveBeenCalledTimes(1));
  expect(usePlayerStore.getState().queue.map(track => track.id)).toEqual(['队列', '历史歌曲']);
  fireEvent.click(screen.getAllByRole('link', { name: '前往登录' })[0]);
  expect(screen.getByLabelText('当前位置').textContent).toBe('/settings');
});

it('登录检查失败保持错误，可重试恢复；不会误报未登录', async () => {
  vi.mocked(ipc.checkLoginStatus).mockRejectedValueOnce({ kind: 'network' }); show();
  await screen.findByText('暂时无法检查登录状态');
  expect(screen.queryByText('登录后同步你的歌单')).toBeNull(); expect(ipc.getSmartRecommend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重试登录检查' })); await screen.findByText('真实推荐');
  expect(ipc.checkLoginStatus).toHaveBeenCalledTimes(2);
});

it('推荐失败不会自动循环请求，重试恢复后首页与详情共享结果', async () => {
  vi.mocked(ipc.getSmartRecommend).mockRejectedValueOnce({ kind: 'network' }); show();
  await screen.findByText('暂时无法获取推荐');
  expect(ipc.getSmartRecommend).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试推荐' })); await screen.findByText('真实推荐');
  expect(useRecommendStore.getState().personalized[0].name).toBe('真实推荐');
  expect(ipc.getSmartRecommend).toHaveBeenCalledTimes(2);
});

it('歌单失败保留上次内容并可重试同步，初始空歌单有明确指引', async () => {
  show(); await screen.findByText('暂时没有歌单');
  act(() => usePlaylistStore.setState({ playlists: playlists.slice(0, 1) }));
  vi.mocked(ipc.getUserPlaylists).mockRejectedValueOnce({ kind: 'network' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: '刷新歌单' }));
  await screen.findByText('歌单刷新失败，保留已同步歌单');
  expect(within(screen.getByRole('region', { name: '我的歌单' })).getByText('歌单0')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试歌单' }));
  await screen.findByRole('button', { name: '查看全部 8 个歌单' });
  expect(usePlaylistStore.getState().error).toBeNull(); expect(ipc.getUserPlaylists).toHaveBeenCalledTimes(2);
});

it('推荐空结果可刷新，降级提示来源，只有重温经典时说明数据含义', async () => {
  vi.mocked(ipc.getSmartRecommend).mockResolvedValueOnce(result()); show();
  await screen.findByText('暂时没有推荐歌曲');
  vi.mocked(ipc.getSmartRecommend).mockResolvedValueOnce({ ...result([song('降级推荐')]), discovery: {
    outcome: 'degraded', availableSources: ['netease'], unavailableSources: ['qqmusic'],
  } });
  fireEvent.click(screen.getByRole('button', { name: '刷新推荐' })); await screen.findByText('降级推荐');
  expect(screen.getByText('部分音源暂不可用，当前来自：网易云')).toBeTruthy();
  act(() => useRecommendStore.setState({ ...result(), rediscover: [song('老歌')] }));
  expect(screen.getByText('暂无新精选，先重温经典')).toBeTruthy(); expect(screen.getByText('老歌')).toBeTruthy();
});
