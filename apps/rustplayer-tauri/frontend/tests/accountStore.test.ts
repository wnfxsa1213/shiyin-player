import { expect, it, vi } from 'vitest';
import { createAccountStore } from '@/store/accountStore';
import type { MusicSource } from '@/lib/ipc';

type Status = Record<MusicSource, boolean>;
function pendingStatus() {
  let resolve!: (status: Status) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Status>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('后台检查保留已确认的状态，多个读取者不重复请求', async () => {
  const read = vi.fn().mockResolvedValue({ netease: true, qqmusic: false });
  const store = createAccountStore(read); await store.getState().refresh();
  const previous = store.getState().status;
  const pending = pendingStatus(); read.mockReturnValueOnce(pending.promise);
  const request = store.getState().refresh(); await store.getState().refresh();
  expect(store.getState().status).toBe(previous); expect(read).toHaveBeenCalledTimes(2);
  pending.resolve({ netease: true, qqmusic: true }); await request;
  expect(store.getState().status).toEqual({ netease: true, qqmusic: true });
  expect(store.getState().refreshing).toBe(false);
});

it('迟到的检查不能撤销新登录，仍可补齐另一个音源的状态', async () => {
  const pending = pendingStatus(); const store = createAccountStore(() => pending.promise);
  const request = store.getState().refresh(); store.getState().setLoggedIn('netease', true);
  expect(store.getState().status?.netease).toBe(true);
  pending.resolve({ netease: false, qqmusic: true }); await request;
  expect(store.getState().status).toEqual({ netease: true, qqmusic: true });
});

it('迟到的检查不能恢复已登出的音源，也不影响仍登录的音源', async () => {
  const pending = pendingStatus(); const store = createAccountStore(() => pending.promise);
  store.getState().setLoggedIn('netease', true); store.getState().setLoggedIn('qqmusic', true);
  const request = store.getState().refresh(); store.getState().setLoggedIn('netease', false);
  pending.resolve({ netease: true, qqmusic: true }); await request;
  expect(store.getState().status).toEqual({ netease: false, qqmusic: true });
});

it('新登录使旧检查失败失效，后续检查失败仍保留已知状态并提供错误', async () => {
  const pending = pendingStatus(); const read = vi.fn().mockReturnValueOnce(pending.promise).mockRejectedValue({ kind: 'network' });
  const store = createAccountStore(read);
  const request = store.getState().refresh(); store.getState().setLoggedIn('qqmusic', true);
  pending.reject({ kind: 'network' }); await request;
  expect(store.getState().status?.qqmusic).toBe(true); expect(store.getState().error).toBeNull();
  const previous = store.getState().status;
  await store.getState().refresh();
  expect(store.getState().status).toBe(previous);
  expect(store.getState().error).toBe('网络连接失败，请检查网络');
});
