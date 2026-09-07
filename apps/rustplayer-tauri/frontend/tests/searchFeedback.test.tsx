// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ipc } from '@/lib/ipc';
import { usePlayerStore, type Track } from '@/store/playerStore';
import SearchView from '@/views/SearchView';

vi.mock('@/lib/ipc', () => ({ ipc: {
  searchMusic: vi.fn(), playTrack: vi.fn(), recordPlayEvent: vi.fn(), getRadioBatch: vi.fn(), stopPlayback: vi.fn(),
} }));
vi.mock('@/lib/settings', () => ({ saveSetting: vi.fn().mockResolvedValue(undefined) }));
const track = (id: string): Track => ({ id, name: id, artist: '歌手', album: '专辑', source: 'netease', durationMs: 180000 });
const deferred = () => {
  let resolve!: (tracks: Track[]) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Track[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = (ms = 450) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const type = (value: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value } });
const submit = () => fireEvent.submit(screen.getByRole('search'));

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.mocked(ipc.searchMusic).mockResolvedValue([]);
  vi.mocked(ipc.playTrack).mockResolvedValue(undefined);
  vi.mocked(ipc.stopPlayback).mockResolvedValue(undefined);
  vi.mocked(ipc.recordPlayEvent).mockResolvedValue(undefined);
  vi.mocked(ipc.getRadioBatch).mockResolvedValue({ tracks: [], discovery: { outcome: 'empty', availableSources: [], unavailableSources: [] } });
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(700);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(async () => {
  cleanup(); await usePlayerStore.getState().clearQueue();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('纯空白保持输入前状态；快速输入合并请求并规范关键词', async () => {
  render(<SearchView />); type('   '); await tick();
  expect(screen.getByText('搜索你喜欢的音乐')).toBeTruthy(); expect(ipc.searchMusic).not.toHaveBeenCalled();
  type('海'); await tick(200); type(' 海边 '); await tick(449);
  expect(ipc.searchMusic).not.toHaveBeenCalled();
  await tick(1); expect(ipc.searchMusic).toHaveBeenCalledExactlyOnceWith('海边', undefined);
  expect(screen.getByText('没有找到相关结果')).toBeTruthy();
});

it('Enter 提交与切换音源立即使用最新输入，不重复执行旧防抖', async () => {
  render(<SearchView />); type('海边'); submit(); await tick(0);
  expect(ipc.searchMusic).toHaveBeenCalledExactlyOnceWith('海边', undefined);
  type('夜航'); fireEvent.click(screen.getByRole('tab', { name: 'QQ音乐' })); await tick(0);
  expect(ipc.searchMusic).toHaveBeenLastCalledWith('夜航', 'qqmusic');
  await tick(1000); expect(ipc.searchMusic).toHaveBeenCalledTimes(2);
});

it('中文组合输入期间不发请求，选词 Enter 不提交搜索', async () => {
  render(<SearchView />); const input = screen.getByRole('searchbox');
  fireEvent.compositionStart(input); type('hai'); submit(); await tick(1000);
  expect(ipc.searchMusic).not.toHaveBeenCalled();
  type('海'); fireEvent.compositionEnd(input); await tick();
  expect(ipc.searchMusic).toHaveBeenCalledExactlyOnceWith('海', undefined);
});

it('首次请求失败有持续错误和重试，成功空结果才显示无结果', async () => {
  vi.mocked(ipc.searchMusic).mockRejectedValueOnce({ kind: 'network' });
  render(<SearchView />); type('海'); await tick();
  expect(screen.getByText('搜索失败')).toBeTruthy(); expect(screen.queryByText('没有找到相关结果')).toBeNull();
  await tick(4000); expect(screen.getByText('搜索失败')).toBeTruthy(); expect(ipc.searchMusic).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试搜索' })); await tick(0);
  expect(ipc.searchMusic).toHaveBeenLastCalledWith('海', undefined);
  expect(screen.queryByText('搜索失败')).toBeNull(); expect(screen.getByText('没有找到相关结果')).toBeTruthy();
});

it('保留可播放的旧结果，并分别标注新请求和旧结果的关键词、音源', async () => {
  vi.mocked(ipc.searchMusic).mockResolvedValueOnce([track('旧曲')]).mockRejectedValueOnce({ kind: 'network' });
  render(<SearchView />); type('海'); await tick();
  usePlayerStore.getState().addToQueue([track('原队列')]);
  type('夜'); expect(screen.getByRole('tabpanel').textContent).toContain('上次结果：「海」 · 全部音源');
  fireEvent.click(screen.getByRole('tab', { name: 'QQ音乐' })); await tick(0);
  expect(screen.getByRole('status').textContent).toContain('「夜」 · QQ音乐');
  fireEvent.click(screen.getByRole('button', { name: '播放：旧曲' })); await tick(0);
  expect(usePlayerStore.getState().queue.map(song => song.id)).toEqual(['原队列', '旧曲']);
  expect(ipc.playTrack).toHaveBeenCalledTimes(1);
});

it.each(['resolve', 'reject'] as const)('输入新词后旧请求迟到 %s 不覆盖防抖和新结果', async outcome => {
  const old = deferred();
  vi.mocked(ipc.searchMusic).mockReturnValueOnce(old.promise).mockResolvedValueOnce([track('新曲')]);
  render(<SearchView />); type('旧'); await tick(); type('新');
  await act(async () => { if (outcome === 'resolve') old.resolve([track('旧曲')]); else old.reject({ kind: 'network' }); });
  expect(screen.getByRole('status').textContent).toContain('准备搜索「新」');
  expect(screen.queryByText('旧曲')).toBeNull(); expect(screen.queryByText('搜索失败')).toBeNull();
  await tick(); expect(screen.getByRole('status').textContent).toContain('「新」 · 全部音源 · 1 首结果');
});

it('切换音源后的新响应优先，迟到旧响应不能替换歌曲', async () => {
  const old = deferred(); const fresh = deferred();
  vi.mocked(ipc.searchMusic).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  render(<SearchView />); type('海'); await tick(); fireEvent.click(screen.getByRole('tab', { name: 'QQ音乐' })); await tick(0);
  await act(async () => fresh.resolve([track('新音源曲')]));
  await act(async () => old.resolve([track('旧音源曲')]));
  expect(screen.getByText('新音源曲')).toBeTruthy(); expect(screen.queryByText('旧音源曲')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('QQ音乐');
});

it.each(['waiting', 'loading'] as const)('清空 %s 搜索立即恢复输入前状态和焦点', async phase => {
  const request = deferred(); vi.mocked(ipc.searchMusic).mockReturnValueOnce(request.promise);
  render(<SearchView />); type('海'); if (phase === 'loading') await tick();
  fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  await act(async () => request.resolve([track('迟到曲')])); await tick();
  expect(screen.getByText('搜索你喜欢的音乐')).toBeTruthy(); expect(screen.queryByText('迟到曲')).toBeNull();
  expect(ipc.searchMusic).toHaveBeenCalledTimes(phase === 'loading' ? 1 : 0);
});

it('页面卸载取消防抖；多个页面实例独立处理响应', async () => {
  const first = render(<SearchView />); type('取消'); first.unmount(); await tick(); expect(ipc.searchMusic).not.toHaveBeenCalled();
  const old = deferred(); const fresh = deferred();
  vi.mocked(ipc.searchMusic).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const a = render(<SearchView />); fireEvent.change(within(a.container).getByRole('searchbox'), { target: { value: '甲' } }); await tick();
  const b = render(<SearchView />); fireEvent.change(within(b.container).getByRole('searchbox'), { target: { value: '乙' } }); await tick();
  await act(async () => { fresh.resolve([track('乙曲')]); old.resolve([track('甲曲')]); });
  expect(within(a.container).getByRole('status').textContent).toContain('「甲」');
  expect(within(b.container).getByRole('status').textContent).toContain('「乙」');
});

it('音源方向键与 Home/End 同步焦点、选择和请求参数', async () => {
  render(<SearchView />); type('海');
  const tabs = screen.getByRole('tablist'); fireEvent.keyDown(tabs, { key: 'End' }); await tick(0);
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'QQ音乐' }));
  expect(ipc.searchMusic).toHaveBeenLastCalledWith('海', 'qqmusic');
  fireEvent.keyDown(tabs, { key: 'ArrowRight' }); await tick(0);
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '全部音源' }));
  fireEvent.keyDown(tabs, { key: 'Home' }); await tick(0);
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('search-source-tab-all');
});
