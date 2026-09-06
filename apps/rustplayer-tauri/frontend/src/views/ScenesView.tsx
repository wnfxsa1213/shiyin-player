import { useEffect, useRef, useState, useCallback } from 'react';
import { Check, Expand, ImagePlus, Music2, Sparkles, Trash2, X } from 'lucide-react';
import { useSceneStore } from '@/store/sceneStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { usePlayerStore } from '@/store/playerStore';
import { useUiStore } from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { SCENE_PRESETS, EFFECT_NAMES, cloneScene, sameScene, sceneAssetId, sceneGradient, type VisualScene } from '@/lib/scenes/model';
import { backgroundUrl } from '@/lib/scenes/assets';
import { ipc } from '@/lib/ipc';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import SceneArtwork from '@/components/scenes/SceneArtwork';
import SceneSurface from '@/components/scenes/SceneSurface';
import SceneRotationControls from '@/components/scenes/SceneRotationControls';

function ScenePreviewDialog({ scene, onClose }: { scene: VisualScene; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const listening = usePlayerStore(state => state.listening);
  useFocusTrap(ref, true, onClose);
  return <div ref={ref} className="scene-preview-dialog" role="dialog" aria-modal="true" aria-label="沉浸预览" tabIndex={-1} data-scene-block>
    <SceneSurface scene={scene} variant="preview" />
    <div className="scene-preview-top"><span>沉浸预览 · {scene.name}</span><button className="scene-button" onClick={onClose}><X size={16} />返回搭配</button></div>
    <div className="scene-preview-composition"><div className="scene-record"><Music2 size={44} strokeWidth={1} /></div><div>
      <span className="scene-eyebrow">让音乐，成为此刻的风景</span>
      <h2>{listening.track?.name || '留一点空间给音乐'}</h2><p>{listening.track?.artist || '选一首喜欢的歌，感受真实音乐律动'}</p>
      <span className="scene-preview-note">当前仅预览，返回后可应用这套搭配</span>
    </div></div>
  </div>;
}

export default function ScenesView() {
  const state = useSceneStore();
  const cover = usePlayerStore(player => player.listening.track?.coverUrl);
  const immersive = useUiStore(ui => ui.immersiveOpen);
  const [draft, setDraft] = useState(() => cloneScene(state.current));
  const [filter, setFilter] = useState<'all' | 'saved'>('all');
  const [preview, setPreview] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [previewPaused, setPreviewPaused] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const initialized = useRef(state.ready);
  const closePreview = useCallback(() => setPreview(false), []);
  useEffect(() => {
    useSceneEnvironment.setState({ editorOpen: true });
    return () => { useSceneEnvironment.setState({ editorOpen: false }); selection.current++; };
  }, []);
  useEffect(() => {
    if (state.ready && !initialized.current) { initialized.current = true; setDraft(cloneScene(state.current)); }
  }, [state.ready, state.current]);

  const library = [...SCENE_PRESETS, ...state.saved];
  const listed = library.find(scene => scene.id === draft.id);
  const dirty = !sameScene(draft, state.current);
  const modifiedPreset = !listed || !sameScene(draft, listed);
  const change = (update: Partial<VisualScene>) => { selection.current++; setDraft(scene => ({ ...scene, ...update })); };
  const choose = (scene: VisualScene) => { selection.current++; setDraft(cloneScene(scene)); setSaveName(null); };
  const importFile = async (file: File) => {
    const revision = ++selection.current;
    const asset = await state.importBackground(file);
    if (asset && revision === selection.current) setDraft(scene => ({ ...scene, background: { kind: 'image', assetId: asset.id } }));
  };
  const save = () => {
    const saved = state.saveAs(draft, saveName ?? draft.name);
    if (saved) { choose(saved); useToastStore.getState().addToast('success', '搭配已保存，可单独加入轮换'); }
  };

  return <div className="scenes-page" data-scene-block>
    <header className="scene-page-header"><div><span className="scene-eyebrow"><Sparkles size={13} /> THE ATMOSPHERE COLLECTION</span>
      <h1>让声音，有风景<span>。</span></h1><p>挑一幕喜欢的光，陪音乐多待一会儿。</p></div>
      <span className="scene-quality-tag"><span />自动画质</span>
    </header>
    <div className="scene-workspace">
      <section className="scene-gallery" aria-label="场景库">
        <div className="scene-section-top"><div className="scene-tabs" role="group" aria-label="场景分类">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部场景 <span>{library.length}</span></button>
          <button aria-pressed={filter === 'saved'} onClick={() => setFilter('saved')}>我的搭配 <span>{state.saved.length}</span></button>
        </div></div>
        <div className="scene-grid">
          {(filter === 'saved' ? state.saved : library).map(scene => {
            const thumbnail = backgroundUrl(scene, state.assets, cover, true);
            return <button key={scene.id} className={`scene-card ${draft.id === scene.id ? 'is-selected' : ''}`} aria-pressed={draft.id === scene.id}
              aria-label={`预览${scene.name}`} onClick={() => choose(scene)}>
              <div className="scene-card-art" style={{ background: sceneGradient(scene), color: scene.colors.particle }}>
                {thumbnail && <img src={thumbnail} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}
                <SceneArtwork effect={scene.effect} />
                {sameScene(scene, state.current) && <span className="scene-card-applied"><Check size={10} />当前</span>}
                {state.rotationIds.includes(scene.id) && <span className="scene-card-member" title="已加入轮换" />}
              </div><div className="scene-card-caption"><strong>{scene.name}</strong><span>{EFFECT_NAMES[scene.effect]}</span></div>
            </button>;
          })}
        </div>
        {filter === 'saved' && !state.saved.length && <div className="scene-empty"><ImagePlus size={28} /><p>把喜欢的背景与特效留在一起。</p><span>选一套场景，调整后点击「另存搭配」。</span></div>}
        <div className="scene-gallery-note"><span>01 — 08</span><p>八种光影，各有自己的节奏。<br />预览满意后再应用，也可以加入轮换，让风景自然流转。</p></div>
      </section>
      <section className="scene-editor" aria-label="场景搭配">
        <div className="scene-preview" style={{ background: sceneGradient(draft) }}>
          <SceneSurface scene={draft} variant="preview" active={!preview && !immersive && !previewPaused} />
          <div className="scene-preview-label"><span>候选预览</span><span>{dirty ? '待应用' : '已应用'}</span></div>
          <div className="scene-preview-title"><span>{EFFECT_NAMES[draft.effect]} / {draft.followMusic ? '音乐跟随' : '舒缓流动'}</span><h2>{draft.name}</h2></div>
          <div className="scene-preview-actions"><button onClick={() => setPreviewPaused(!previewPaused)} aria-pressed={previewPaused}>{previewPaused ? '继续预览' : '暂停预览'}</button><button onClick={() => setPreview(true)}><Expand size={13} />沉浸预览</button></div>
        </div>
        <div className="scene-editor-options">
          <div className="scene-field"><label htmlFor="scene-background">背景</label><select id="scene-background" value={draft.background.kind === 'image' ? draft.background.assetId : draft.background.kind}
            onChange={event => change({ background: event.target.value === 'gradient' ? { kind: 'gradient' } : event.target.value === 'cover' ? { kind: 'cover' } : { kind: 'image', assetId: event.target.value } })}>
            <option value="gradient">场景渐变</option><option value="cover">当前专辑封面</option>
            {state.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
          </select></div>
          <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="导入背景图片" tabIndex={-1} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} />
          <button className="scene-import" disabled={!state.ready || state.importing} onClick={() => fileRef.current?.click()}><ImagePlus size={16} />{state.importing ? '正在导入…' : '导入自己的背景'}<span>JPG / PNG / WebP · 20 MB</span></button>
          <div className="scene-field"><div><label htmlFor="scene-follow">音乐跟随</label><small>随真实音乐强弱和低频起伏</small></div><input id="scene-follow" type="checkbox" role="switch" checked={draft.followMusic} onChange={event => change({ followMusic: event.target.checked })} /></div>
          <div className="scene-field"><div><label htmlFor="scene-member">加入我的轮换</label><small>{modifiedPreset ? '搭配有改动，另存后可加入轮换' : '保存与参与轮换分别设置'}</small></div><input id="scene-member" type="checkbox" checked={!modifiedPreset && state.rotationIds.includes(draft.id)} disabled={!state.ready || modifiedPreset} onChange={event => state.setRotationMember(draft.id, event.target.checked)} /></div>
          {saveName !== null && <form className="scene-save-form" onSubmit={event => { event.preventDefault(); save(); }}><label htmlFor="scene-save-name">搭配名称</label><input id="scene-save-name" autoFocus maxLength={64} value={saveName} onChange={event => setSaveName(event.target.value)} /><button className="scene-button scene-button--primary" type="submit">保存</button><button className="scene-button" type="button" onClick={() => setSaveName(null)}>取消</button></form>}
          <div className="scene-editor-buttons"><button className="scene-button" disabled={!state.ready} onClick={() => setSaveName(`我的${draft.name}`)}>另存搭配</button><button className="scene-button scene-button--primary" disabled={!state.ready || !dirty || state.applying} onClick={() => void state.apply(draft)}>{state.applying ? '准备场景…' : dirty ? '应用场景' : '已应用'}<Check size={15} /></button></div>
          {draft.id.startsWith('user-') && <button className="scene-text-button" disabled={state.current.id === draft.id} onClick={() => { state.removeSaved(draft.id); choose(state.current); }}><Trash2 size={12} />删除这套搭配</button>}
        </div>
      </section>
    </div>
    <SceneRotationControls />
    {state.assets.length > 0 && <details className="scene-assets"><summary>背景素材 <span>{state.assets.length} 张 · {(state.assets.reduce((sum, asset) => sum + asset.byteSize, 0) / 1024 / 1024).toFixed(1)} MB / 512 MB</span></summary>
      <p>图片已存入拾音，移动原文件不会影响背景。移除未使用图片可以释放空间。</p><div className="scene-asset-grid">{state.assets.map(asset => {
        const used = [state.current, ...state.saved, draft].some(scene => sceneAssetId(scene) === asset.id);
        return <div key={asset.id} className="scene-asset"><img src={ipc.sceneAssetUrl(asset.thumbnailPath)} alt="" loading="lazy" /><span title={asset.name}>{asset.name}</span><button className="scene-text-button" disabled={used || state.importing || state.applying} onClick={() => void state.removeBackground(asset.id)} aria-label={`移除背景${asset.name}`}>{used ? '使用中' : '移除'}</button></div>;
      })}</div>
    </details>}
    {preview && <ScenePreviewDialog scene={draft} onClose={closePreview} />}
  </div>;
}
