// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSceneStore } from '@/store/sceneStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { defaultSceneSettings, type SceneAsset, type VisualScene } from '@/lib/scenes/model';
import { useToastStore } from '@/store/toastStore';
import { ipc } from '@/lib/ipc';
import ScenesView from '@/views/ScenesView';

vi.mock('@/lib/settings', () => ({ loadSetting: vi.fn().mockResolvedValue(null), saveSetting: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/ipc', () => ({ ipc: { listSceneBackgrounds: vi.fn().mockResolvedValue([]), importSceneBackground: vi.fn(), deleteSceneBackground: vi.fn().mockResolvedValue(undefined), sceneAssetUrl: (path: string) => path } }));
vi.mock('@/lib/scenes/assets', () => ({ prepareBackground: vi.fn().mockResolvedValue(undefined), backgroundUrl: () => null }));
// Canvas rendering is verified in real browsers; here we exercise the actual editor and store boundary.
vi.mock('@/components/scenes/SceneSurface', () => ({ default: ({ scene }: { scene: VisualScene }) => <div data-testid="surface">{scene.effect}</div> }));

beforeEach(async () => {
  await useSceneStore.getState().initialize();
  useSceneStore.setState({ ...defaultSceneSettings(), assets: [], ready: true, applying: false, importing: false });
});
afterEach(async () => {
  cleanup(); await useSceneStore.getState().flush();
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().removeToast(toast.id);
});

it('卡片只改变候选，跟随与背景变更需要应用，保存与轮换独立', async () => {
  render(<ScenesView />);
  expect(useSceneEnvironment.getState().editorOpen).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '预览雨夜' }));
  expect(useSceneStore.getState().current.id).toBe('star');
  fireEvent.click(screen.getByRole('button', { name: '应用场景' }));
  await waitFor(() => expect(useSceneStore.getState().current.id).toBe('rain'));
  fireEvent.click(screen.getByRole('switch', { name: '音乐跟随' }));
  expect(screen.getByRole('button', { name: '应用场景' })).toBeTruthy();
  expect(useSceneStore.getState().current.followMusic).toBe(true);
  expect((screen.getByLabelText('加入我的轮换') as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('背景'), { target: { value: 'cover' } });
  fireEvent.click(screen.getByRole('button', { name: '另存搭配' }));
  fireEvent.change(screen.getByLabelText('搭配名称'), { target: { value: '夜的封面' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  const saved = useSceneStore.getState().saved[0];
  expect(saved).toMatchObject({ name: '夜的封面', followMusic: false, background: { kind: 'cover' } });
  expect(useSceneStore.getState().rotationIds).not.toContain(saved.id);
  expect(useSceneStore.getState().current.background.kind).toBe('gradient');
  fireEvent.click(screen.getByLabelText('加入我的轮换'));
  expect(useSceneStore.getState().rotationIds).toContain(saved.id);
});

it('导入失败保留草稿，迟到的导入结果不会覆盖用户的新选择', async () => {
  let resolve!: (value: SceneAsset) => void;
  vi.mocked(ipc.importSceneBackground).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  render(<ScenesView />);
  fireEvent.change(screen.getByLabelText('导入背景图片'), { target: { files: [new File(['abc'], '背景.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: '预览初雪' }));
  await act(async () => { resolve({ id: 'a'.repeat(64), name: '背景.png', displayPath: 'display', thumbnailPath: 'thumb', width: 10, height: 10, byteSize: 100 }); });
  expect((screen.getByLabelText('背景') as HTMLSelectElement).value).toBe('gradient');
  expect(screen.getByTestId('surface').textContent).toBe('snow');
  vi.mocked(ipc.importSceneBackground).mockRejectedValueOnce(new Error('bad image'));
  fireEvent.change(screen.getByLabelText('导入背景图片'), { target: { files: [new File(['bad'], 'broken.png')] } });
  await waitFor(() => expect(useSceneStore.getState().importing).toBe(false));
  expect(screen.getByTestId('surface').textContent).toBe('snow');
});

it('沉浸预览退出回到入口焦点，不改变当前搭配；卸载解除避让', () => {
  const { unmount } = render(<ScenesView />);
  fireEvent.click(screen.getByRole('button', { name: '预览萤火' }));
  const trigger = screen.getByRole('button', { name: '沉浸预览' }); trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: '沉浸预览' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '歌词' })).toBeTruthy();
  expect(screen.getByLabelText('歌词排版示例')).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
  expect(useSceneStore.getState().current.id).toBe('star'); unmount(); expect(useSceneEnvironment.getState().editorOpen).toBe(false);
});
