import { describe, expect, it, vi } from 'vitest';
import { createSceneStore } from '@/lib/scenes/sceneStore';
import { createSceneBag, createSceneRotation, type RotationInput } from '@/lib/scenes/rotation';
import { cloneScene, defaultSceneSettings, parseSceneSettings, sameScene, SCENE_PRESETS, type SceneAsset, type SceneSettings } from '@/lib/scenes/model';
import { createQualityGovernor, spectrumEnergy } from '@/lib/scenes/renderer';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const asset: SceneAsset = { id: 'a'.repeat(64), name: '背景.png', displayPath: 'display.webp', thumbnailPath: 'thumb.webp', width: 640, height: 480, byteSize: 1000 };
function fixture() {
  let id = 0;
  const deps = {
    load: vi.fn().mockResolvedValue(null), save: vi.fn<(settings: SceneSettings) => Promise<void>>().mockResolvedValue(undefined),
    listAssets: vi.fn().mockResolvedValue([asset]), importAsset: vi.fn().mockResolvedValue(asset), deleteAsset: vi.fn().mockResolvedValue(undefined),
    prepare: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), notify: vi.fn(), errorMessage: String, newId: () => String(++id),
  };
  return { deps, store: createSceneStore(deps) };
}
const flushPromises = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('场景选择与素材', () => {
  it('初始化去重，草稿、应用、保存与轮换互不混淆', async () => {
    const { store, deps } = fixture();
    await Promise.all([store.getState().initialize(), store.getState().initialize()]);
    expect(deps.load).toHaveBeenCalledTimes(1);
    const candidate = cloneScene(store.getState().current);
    candidate.background = { kind: 'image', assetId: asset.id }; candidate.followMusic = false;
    expect(sameScene(candidate, store.getState().current)).toBe(false);
    const saved = store.getState().saveAs(candidate, '我的雨夜')!;
    expect(store.getState().current.background.kind).toBe('gradient');
    expect(store.getState().rotationIds).not.toContain(saved.id);
    await store.getState().apply(candidate);
    candidate.followMusic = true;
    expect(store.getState().current.followMusic).toBe(false);
    expect(store.getState().saved[0].followMusic).toBe(false);
    store.getState().setRotationMember(saved.id, true);
    expect(store.getState().rotationIds).toContain(saved.id);
    await store.getState().flush();
    expect(deps.save.mock.calls.at(-1)?.[0].current.background).toEqual({ kind: 'image', assetId: asset.id });
  });

  it('最新应用优先，旧图加载完成不覆盖；加载失败保留当前场景', async () => {
    const { store, deps } = fixture(); await store.getState().initialize();
    const first = deferred<void>(); deps.prepare.mockReturnValueOnce(first.promise);
    const pending = store.getState().apply(SCENE_PRESETS[1]);
    await store.getState().apply(SCENE_PRESETS[2]); first.resolve(); await pending;
    expect(store.getState().current.id).toBe('snow');
    deps.prepare.mockRejectedValueOnce(new Error('missing'));
    expect(await store.getState().apply(SCENE_PRESETS[3])).toBe(false);
    expect(store.getState().current.id).toBe('snow');
    expect(deps.notify).toHaveBeenCalledWith('error', expect.stringContaining('已保留当前场景'));
  });

  it('加载期间锁定或开始操作，可撤销自动应用', async () => {
    const { store, deps } = fixture(); await store.getState().initialize();
    const preparing = deferred<void>(); deps.prepare.mockReturnValueOnce(preparing.promise);
    let idle = true;
    const pending = store.getState().apply(SCENE_PRESETS[1], () => idle);
    idle = false; preparing.resolve();
    expect(await pending).toBe(false); expect(store.getState().current.id).toBe('star');
  });

  it('保存按顺序落盘，失败不阻止后续设置', async () => {
    const { store, deps } = fixture(); await store.getState().initialize();
    const writing = deferred<void>(); deps.save.mockReturnValueOnce(writing.promise);
    store.getState().setLocked(true); store.getState().setLocked(false);
    await flushPromises(); expect(deps.save).toHaveBeenCalledTimes(1);
    writing.reject(new Error('disk')); await store.getState().flush();
    expect(deps.save.mock.calls.map(call => call[0].locked)).toEqual([true, false]);
    expect(deps.notify).toHaveBeenCalledWith('error', expect.stringContaining('保存失败'));
  });

  it('在用、准备中和正在删除的素材不会被交叉引用或移除', async () => {
    const { store, deps } = fixture(); await store.getState().initialize();
    const candidate = { ...cloneScene(SCENE_PRESETS[0]), background: { kind: 'image' as const, assetId: asset.id } };
    const ready = deferred<void>(); deps.prepare.mockReturnValueOnce(ready.promise);
    const pending = store.getState().apply(candidate);
    expect(await store.getState().removeBackground(asset.id)).toBe(false);
    ready.resolve(); await pending;
    expect(await store.getState().removeBackground(asset.id)).toBe(false);
    await store.getState().apply(SCENE_PRESETS[0]);
    const deleting = deferred<void>(); deps.deleteAsset.mockReturnValueOnce(deleting.promise);
    const removal = store.getState().removeBackground(asset.id);
    expect(await store.getState().apply(candidate)).toBe(false);
    expect(store.getState().saveAs(candidate, '禁止悬空引用')).toBeNull();
    deleting.resolve(); expect(await removal).toBe(true); expect(store.getState().assets).toEqual([]);
  });

  it('重复导入只保留一个素材，删除搭配也清除其轮换成员', async () => {
    const { store, deps } = fixture(); await store.getState().initialize();
    await store.getState().importBackground({} as File); await store.getState().importBackground({} as File);
    expect(store.getState().assets).toHaveLength(1); expect(deps.importAsset).toHaveBeenCalledTimes(2);
    const saved = store.getState().saveAs(SCENE_PRESETS[0], '收藏')!;
    store.getState().setRotationMember(saved.id, true); store.getState().removeSaved(saved.id);
    expect(store.getState().saved).toEqual([]); expect(store.getState().rotationIds).not.toContain(saved.id);
  });

  it('损坏配置回退且不会注入未知效果、样式或轮换标识', () => {
    expect(parseSceneSettings({ version: 2 })).toEqual(defaultSceneSettings());
    const parsed = parseSceneSettings({ ...defaultSceneSettings(), current: { ...SCENE_PRESETS[0], colors: { primary: 'url(file:///etc/passwd)' } }, rotationIds: ['star', 'star', 'unknown'], saved: [SCENE_PRESETS[0]] });
    expect(parsed.current).toEqual(SCENE_PRESETS[0]); expect(parsed.rotationIds).toEqual(['star']); expect(parsed.saved).toEqual([]);
  });
});

function rotationFixture() {
  let now = 0;
  let input: RotationInput = { playing: true, visible: true, blocked: false, locked: false, sessionId: 1, scene: {} };
  const rotate = vi.fn<(guard: () => boolean) => Promise<boolean>>().mockImplementation(async guard => guard());
  const runtime = createSceneRotation({ now: () => now, rotate }); runtime.update(input);
  return { runtime, rotate, advance: (ms: number) => { now += ms; runtime.tick(); }, update: (next: Partial<RotationInput>) => { input = { ...input, ...next }; runtime.update(input); } };
}
describe('自适应随机轮换', () => {
  it('60 秒前快速切歌不换景，新的真实播放开始才提供机会', async () => {
    const f = rotationFixture(); f.advance(59_000); f.update({ sessionId: 2 });
    expect(f.rotate).not.toHaveBeenCalled(); f.advance(1000); f.update({ sessionId: 3 }); await flushPromises();
    expect(f.rotate).toHaveBeenCalledTimes(1);
    f.advance(65_000); f.update({ playing: false }); f.update({ playing: true });
    expect(f.rotate).toHaveBeenCalledTimes(1);
  });
  it('只累计可见播放时间，长曲在 5 分钟轮换；恢复不补跑', async () => {
    const f = rotationFixture(); f.advance(100_000); f.update({ visible: false });
    f.advance(900_000); f.update({ sessionId: 8 }); f.update({ visible: true });
    expect(f.rotate).not.toHaveBeenCalled(); f.update({ playing: false }); f.advance(900_000);
    f.update({ playing: true }); f.advance(199_999); expect(f.rotate).not.toHaveBeenCalled();
    f.advance(1); await flushPromises(); expect(f.rotate).toHaveBeenCalledTimes(1);
  });
  it('预览和交互期间最多保留一次切换，空闲 3 秒后执行', async () => {
    const f = rotationFixture(); f.update({ blocked: true }); f.advance(300_000); f.update({ sessionId: 2 }); f.update({ sessionId: 3 });
    f.runtime.interact(); f.update({ blocked: false }); f.advance(2999); expect(f.rotate).not.toHaveBeenCalled();
    f.advance(1); await flushPromises(); f.advance(1000); expect(f.rotate).toHaveBeenCalledTimes(1);
  });
  it('锁定会取消加载中的自动切换，解锁重新计时', async () => {
    const f = rotationFixture(), loading = deferred<boolean>(); let guard!: () => boolean;
    f.rotate.mockImplementationOnce(canCommit => { guard = canCommit; return loading.promise; });
    f.advance(300_000); f.update({ locked: true }); expect(guard()).toBe(false);
    loading.resolve(false); await flushPromises(); f.advance(900_000); f.update({ locked: false });
    f.advance(299_999); expect(f.rotate).toHaveBeenCalledTimes(1); f.advance(1); expect(f.rotate).toHaveBeenCalledTimes(2);
  });
  it('异步加载时的新操作会延期，失败不会每秒重试', async () => {
    const f = rotationFixture(), load = deferred<boolean>(); let guard!: () => boolean;
    f.rotate.mockImplementationOnce(canCommit => { guard = canCommit; return load.promise; });
    f.advance(300_000); f.runtime.interact(); expect(guard()).toBe(false); load.resolve(false); await flushPromises();
    f.advance(3000); await flushPromises(); expect(f.rotate).toHaveBeenCalledTimes(2);
    f.rotate.mockResolvedValue(false); f.advance(300_000); await flushPromises();
    f.advance(10_000); expect(f.rotate).toHaveBeenCalledTimes(3);
  });
  it('洗牌覆盖全部成员，每轮边界也不连续重复，集合变化及时生效', () => {
    const bag = createSceneBag(() => .5); let current = 'outside';
    const results = Array.from({ length: 60 }, () => { const next = bag.next(['a', 'b', 'c'], current)!; expect(next).not.toBe(current); current = next; return next; });
    for (let index = 0; index < results.length; index += 3) expect(new Set(results.slice(index, index + 3)).size).toBe(3);
    expect(bag.next(['x'], current)).toBe('x'); expect(bag.next(['x'], 'x')).toBeNull(); expect(bag.next([], 'x')).toBeNull();
  });
});

describe('音频与画质预算', () => {
  it('静音为零、低频显著参与强度，无效数据不会污染绘制', () => {
    expect(spectrumEnergy(new Float32Array(64))).toBe(0);
    const low = new Float32Array(64); low.fill(.5, 0, 8);
    const high = new Float32Array(64); high.fill(.5, 40, 48);
    expect(spectrumEnergy(low)).toBeGreaterThan(spectrumEnergy(high) * 3);
    expect(Number.isFinite(spectrumEnergy(new Float32Array([NaN, Infinity])))).toBe(true);
  });
  it('连续慢帧降级，短暂负载和暂停不让画质跳变，恢复有迟滞', () => {
    const governor = createQualityGovernor();
    for (let i = 0; i < 61; i++) governor.observe(33, 1);
    expect(governor.tier).toBe(1);
    for (let i = 0; i < 61; i++) governor.observe(33, 1);
    expect(governor.tier).toBe(0);
    for (let i = 0; i < 7 * 100; i++) governor.observe(20, 1);
    expect(governor.tier).toBe(0); governor.resetWindow();
    for (let i = 0; i < 8 * 100; i++) governor.observe(20, 1);
    expect(governor.tier).toBe(1);
  });
});
