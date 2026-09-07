// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '@/App';
import { ipc, onLoginSuccess, type MusicSource, type PlaylistBrief } from '@/lib/ipc';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaylistStore } from '@/store/playlistStore';
import { useRecommendStore } from '@/store/recommendStore';
import { useUiStore } from '@/store/uiStore';
import { useVisualizerStore } from '@/store/visualizerStore';
import { useToastStore } from '@/store/toastStore';
import { useAccountStore } from '@/store/accountStore';

vi.mock('@/lib/ipc', () => ({
  ipc: {
    checkLoginStatus: vi.fn(), getUserPlaylists: vi.fn(), getSmartRecommend: vi.fn(), listSceneBackgrounds: vi.fn(),
    stopPlayback: vi.fn(), recordPlayEvent: vi.fn(), clientLog: vi.fn(), logout: vi.fn(),
  },
  onLoginSuccess: vi.fn(),
  onLoginTimeout: vi.fn(async () => () => {}),
  onPlaybackEvent: vi.fn(async () => () => {}),
  onPlayerSpectrum: vi.fn(async () => () => {}),
  onPlayerWindowChanged: vi.fn(async () => () => {}),
  isPlayerWindowVisible: vi.fn(async () => true),
}));
vi.mock('@/lib/settings', () => ({ loadSetting: vi.fn(async () => null), saveSetting: vi.fn(async () => {}) }));

const playlists: PlaylistBrief[] = [{ id: 'mine', name: '我的测试歌单', source: 'netease', trackCount: 1 }];
const loginListeners = new Set<(source: MusicSource) => void>();
const login = (source: MusicSource) => act(() => { for (const listener of loginListeners) listener(source); });

beforeEach(() => {
  vi.clearAllMocks(); loginListeners.clear();
  useAccountStore.setState(useAccountStore.getInitialState(), true);
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  usePlaylistStore.setState(usePlaylistStore.getInitialState(), true);
  useRecommendStore.setState(useRecommendStore.getInitialState(), true);
  useUiStore.setState(useUiStore.getInitialState(), true);
  useVisualizerStore.setState({ enabled: false, showParticles: false });
  vi.mocked(ipc.checkLoginStatus).mockReset().mockResolvedValue({ netease: false, qqmusic: false });
  vi.mocked(ipc.getUserPlaylists).mockResolvedValue([]);
  vi.mocked(ipc.getSmartRecommend).mockResolvedValue({
    personalized: [{ id: 'pick', name: '真实推荐', artist: '歌手', album: '专辑', source: 'netease', durationMs: 180000 }],
    rediscover: [], topArtists: [], discovery: { outcome: 'complete', availableSources: ['netease'], unavailableSources: [] },
  });
  vi.mocked(ipc.listSceneBackgrounds).mockResolvedValue([]);
  vi.mocked(ipc.stopPlayback).mockResolvedValue(undefined);
  vi.mocked(ipc.recordPlayEvent).mockResolvedValue(undefined);
  vi.mocked(ipc.clientLog).mockResolvedValue(undefined);
  vi.mocked(ipc.logout).mockReset().mockResolvedValue(undefined);
  vi.mocked(onLoginSuccess).mockImplementation(async listener => {
    loginListeners.add(listener); return () => { loginListeners.delete(listener); };
  });
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
});

afterEach(async () => {
  cleanup(); await usePlayerStore.getState().clearQueue();
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().removeToast(toast.id);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(['netease', 'qqmusic'] as const)('%s 登录成功后即使歌单同步失败，首页仍显示推荐和歌单重试', async source => {
  render(<App />); await screen.findByText('登录后同步你的歌单');
  await waitFor(() => expect(usePlaylistStore.getState().loading).toBe(false));
  vi.mocked(ipc.getUserPlaylists).mockRejectedValueOnce({ kind: 'network' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  login(source);
  await waitFor(() => expect(usePlaylistStore.getState().error).not.toBeNull());
  expect(screen.queryByText('登录后同步你的歌单')).toBeNull();
  expect(screen.getByRole('button', { name: '重试歌单' })).toBeTruthy();
  await screen.findByText('真实推荐');
  expect(ipc.getUserPlaylists).toHaveBeenLastCalledWith(source);
});

it('歌单请求仍在进行时，登录成功会立即解除首页登录提示', async () => {
  let finish!: (value: PlaylistBrief[]) => void;
  vi.mocked(ipc.getUserPlaylists).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<App />); await screen.findByText('登录后同步你的歌单');
  login('netease');
  try {
    await screen.findByText('真实推荐');
    expect(screen.queryByText('登录后同步你的歌单')).toBeNull();
    expect(screen.getByText('正在同步歌单…')).toBeTruthy();
    expect(ipc.getUserPlaylists).toHaveBeenCalledTimes(1);
  } finally { await act(async () => { finish([]); }); }
});

it.each(['playlist', 'recommendation'] as const)('可见性触发歌单刷新后保留 %s 节点与焦点', async target => {
  vi.mocked(ipc.checkLoginStatus).mockResolvedValue({ netease: true, qqmusic: false });
  vi.mocked(ipc.getUserPlaylists).mockResolvedValue(playlists);
  render(<App />); await screen.findByText('真实推荐');
  const section = screen.getByRole('region', { name: '我的歌单' });
  const link = within(section).getByRole('link', { name: '打开歌单：我的测试歌单' });
  let focused: Element;
  if (target === 'playlist') { link.focus(); focused = link; }
  else {
    const trigger = screen.getByRole('button', { name: '更多操作：真实推荐' }); trigger.focus(); fireEvent.click(trigger);
    focused = screen.getByRole('menuitem', { name: '播放这首' });
  }
  // Native IPC resolves in a later task. Keep an incidental login recheck pending
  // so batching an immediately resolved mock cannot hide a content unmount.
  let finishRecheck: ((value: Record<MusicSource, boolean>) => void) | undefined;
  vi.mocked(ipc.checkLoginStatus).mockImplementationOnce(() => new Promise(resolve => { finishRecheck = resolve; }));
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000);
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(usePlaylistStore.getState().lastFetchedAt).toBeGreaterThan(now));
  try {
    expect(link.isConnected).toBe(true);
    expect(focused.isConnected).toBe(true);
    expect(document.activeElement).toBe(focused);
  } finally { await act(async () => { finishRecheck?.({ netease: true, qqmusic: false }); }); }
});

it.each([false, true])('设置页登出失败=%s 时，只在成功后更新共享账号状态', async fails => {
  vi.mocked(ipc.checkLoginStatus).mockResolvedValue({ netease: true, qqmusic: false });
  render(<App />); await screen.findByText('真实推荐');
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('link', { name: '设置' }));
  const logout = await screen.findByRole('button', { name: '登出' });
  if (fails) vi.mocked(ipc.logout).mockRejectedValueOnce({ kind: 'network' });
  fireEvent.click(logout);
  await waitFor(() => expect(useToastStore.getState().toasts.some(toast => toast.message.startsWith(fails ? '登出失败' : '已登出'))).toBe(true));
  expect(useAccountStore.getState().status?.netease).toBe(fails);
  expect(ipc.logout).toHaveBeenCalledExactlyOnceWith('netease');
});
