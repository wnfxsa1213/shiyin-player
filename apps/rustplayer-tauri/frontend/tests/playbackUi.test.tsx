// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ipc } from '@/lib/ipc';
import { usePlayerStore, type Track } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import PlayerBar from '@/components/layout/PlayerBar';
import QueuePanel from '@/components/player/QueuePanel';
import TrackRow from '@/components/common/TrackRow';
import TrackCard from '@/components/recommend/TrackCard';

vi.mock('@/lib/ipc', () => ({ ipc: {
  playTrack: vi.fn(), stopPlayback: vi.fn(), setPlaybackPaused: vi.fn(), seek: vi.fn(),
  setVolume: vi.fn(), recordPlayEvent: vi.fn(), getRadioBatch: vi.fn(),
} }));
vi.mock('@/lib/settings', () => ({ saveSetting: vi.fn().mockResolvedValue(undefined) }));
const track = (id: string): Track => ({ id, name: id, artist: '测试歌手', album: '测试专辑', durationMs: 180_000, source: 'netease' });
const originalScrollTo = HTMLElement.prototype.scrollTo;
const bar = () => render(<MemoryRouter><PlayerBar lyricsOpen={false} queueOpen={false} onToggleLyrics={() => {}} onToggleQueue={() => {}} /></MemoryRouter>);
const start = async (song: Track) => {
  await usePlayerStore.getState().playTrack(song);
  usePlayerStore.getState().handlePlaybackEvent({ type: 'state', playbackId: usePlayerStore.getState().playbackId!, state: 'playing', positionMs: 0 });
};

beforeEach(async () => {
  vi.resetAllMocks();
  for (const method of [ipc.playTrack, ipc.stopPlayback, ipc.setPlaybackPaused, ipc.seek, ipc.setVolume, ipc.recordPlayEvent]) vi.mocked(method).mockResolvedValue(undefined);
  vi.mocked(ipc.getRadioBatch).mockResolvedValue({ tracks: [], discovery: { outcome: 'empty', availableSources: [], unavailableSources: [] } });
  await usePlayerStore.getState().clearQueue();
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  useSceneEnvironment.setState({ visible: true, reducedMotion: true });
  // Only supply the layout/scroll facts jsdom lacks; the real virtualizer and store run unchanged.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(256);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(380);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return Number.parseFloat((this.firstElementChild as HTMLElement)?.style.height || '256'); });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollTo = function (options: ScrollToOptions | number = {}) {
    this.scrollTop = typeof options === 'number' ? options : options.top ?? 0;
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
  };
});
afterEach(async () => {
  cleanup(); await usePlayerStore.getState().clearQueue(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  HTMLElement.prototype.scrollTo = originalScrollTo;
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().removeToast(toast.id);
});

it('从待播放队列开始，加载时可暂停，缓冲与恢复的文案和按钮保持一致', async () => {
  usePlayerStore.getState().addToQueue([track('山海')]); bar();
  expect(screen.getByText('队列待播放')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '播放' }));
  await screen.findByText('正在加载');
  fireEvent.click(screen.getByRole('button', { name: '暂停' }));
  await screen.findByText('已暂停 · 就绪后保持暂停');
  const id = usePlayerStore.getState().playbackId!;
  act(() => usePlayerStore.getState().handlePlaybackEvent({ type: 'buffering', playbackId: id, percent: 36 }));
  expect(screen.getByText('已暂停 · 缓冲中 36%')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '播放' }));
  await screen.findByText('缓冲中 36%');
  act(() => usePlayerStore.getState().handlePlaybackEvent({ type: 'state', playbackId: id, state: 'playing', positionMs: 0 }));
  expect(screen.getByText('正在播放')).toBeTruthy();
  expect(ipc.playTrack).toHaveBeenCalledTimes(1);
});

it('加载新曲时说明旧曲仍在播放，回滚后的恢复按钮重试失败歌曲', async () => {
  await start(track('原曲')); bar();
  let reject!: (error: unknown) => void;
  vi.mocked(ipc.playTrack).mockReturnValueOnce(new Promise((_resolve, no) => { reject = no; }));
  let request!: Promise<void>;
  act(() => { request = usePlayerStore.getState().playTrack(track('目标曲')); });
  expect(screen.getByText('正在加载 ·「原曲」仍在播放')).toBeTruthy();
  await act(async () => { reject({ kind: 'unauthorized' }); await request; });
  expect(screen.getByText('无法播放「目标曲」')).toBeTruthy();
  expect(screen.getByText('原曲')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试这首' }));
  await waitFor(() => expect(ipc.playTrack).toHaveBeenLastCalledWith(expect.objectContaining({ id: '目标曲' }), expect.any(Number), 0, false));
  expect(screen.queryByText('无法播放「目标曲」')).toBeNull();
});

it('推荐卡片和歌曲行共用播放单曲行为，已有队列不被替换，双击子按钮不重复加载', async () => {
  await start(track('原曲'));
  render(<><TrackRow track={track('新曲')} index={1} /><TrackCard track={track('推荐曲')} /></>);
  const row = screen.getByRole('listitem');
  fireEvent.click(row); expect(ipc.playTrack).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(row, { key: 'Enter' });
  await waitFor(() => expect(ipc.playTrack).toHaveBeenCalledTimes(2));
  const play = screen.getByRole('button', { name: '播放：新曲' });
  fireEvent.click(play); fireEvent.doubleClick(play);
  expect(ipc.playTrack).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '播放：推荐曲，测试歌手' }));
  await waitFor(() => expect(ipc.playTrack).toHaveBeenCalledTimes(3));
  expect(usePlayerStore.getState().queue.map(item => item.id)).toEqual(['原曲', '新曲', '推荐曲']);
});

it('更多菜单可以键盘打开和关闭，返回原焦点，加入队列不会误触播放', async () => {
  render(<TrackRow track={track('候选曲')} index={1} />);
  const row = screen.getByRole('listitem'); row.focus();
  fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
  const menu = screen.getByRole('menu');
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '播放这首' }));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '复制歌曲名' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(row);
  const more = screen.getByRole('button', { name: '更多操作：候选曲' }); more.focus(); fireEvent.click(more);
  fireEvent.click(screen.getByRole('menuitem', { name: '加入队列' }));
  expect(document.activeElement).toBe(more);
  expect(usePlayerStore.getState().queue).toHaveLength(1); expect(ipc.playTrack).not.toHaveBeenCalled();
  fireEvent.click(more); fireEvent.click(screen.getByRole('menuitem', { name: '加入队列' }));
  expect(usePlayerStore.getState().queue).toHaveLength(1);
  expect(useToastStore.getState().toasts.some(item => item.message.includes('已在队列中'))).toBe(true);
});

function QueueHarness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>打开队列</button><QueuePanel isOpen={open} onClose={() => setOpen(false)} /></>;
}

it('队列定位到屏幕外当前歌曲，键盘跨虚拟列表移动，移除后焦点留在相邻条目', async () => {
  usePlayerStore.getState().addToQueue(Array.from({ length: 40 }, (_, index) => track(`歌曲${index}`)));
  await start(track('歌曲25')); render(<QueueHarness />);
  const open = screen.getByRole('button', { name: '打开队列' }); open.focus(); fireEvent.click(open);
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('播放：歌曲25，测试歌手'));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('播放：歌曲39，测试歌手'));
  const remove = screen.getByRole('button', { name: '移除：歌曲39' }); remove.focus(); fireEvent.click(remove);
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('播放：歌曲38，测试歌手'));
  expect(usePlayerStore.getState().currentTrack?.id).toBe('歌曲25');
  fireEvent.click(screen.getByRole('button', { name: '定位当前歌曲' }));
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('播放：歌曲25，测试歌手'));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(open);
});

it('清空需要明确确认，Escape 先取消，完成后停止播放并显示空状态', async () => {
  await start(track('唯一歌曲')); render(<QueueHarness />);
  fireEvent.click(screen.getByRole('button', { name: '打开队列' }));
  fireEvent.click(screen.getByRole('button', { name: '清空队列' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '清空并停止' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(usePlayerStore.getState().queue).toHaveLength(1);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '清空队列' }));
  fireEvent.click(screen.getByRole('button', { name: '清空队列' }));
  fireEvent.click(screen.getByRole('button', { name: '清空并停止' }));
  await screen.findByText('让喜欢的歌排好队');
  expect(usePlayerStore.getState()).toMatchObject({ queue: [], currentTrack: null, state: 'idle' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭播放队列' }));
});
