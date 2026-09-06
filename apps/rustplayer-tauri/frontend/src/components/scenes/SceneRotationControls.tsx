import { LockKeyhole, LockKeyholeOpen, Shuffle } from 'lucide-react';
import { useSceneStore } from '@/store/sceneStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { usePlayerStore } from '@/store/playerStore';
import { nextScene } from '@/lib/scenes/runtime';

export default function SceneRotationControls({ compact = false }: { compact?: boolean }) {
  const locked = useSceneStore(state => state.locked);
  const ready = useSceneStore(state => state.ready);
  const applying = useSceneStore(state => state.applying);
  const count = useSceneStore(state => state.rotationIds.length);
  const current = useSceneStore(state => state.current.name);
  const editing = useSceneEnvironment(state => state.editorOpen);
  const playing = usePlayerStore(state => state.state === 'playing');
  return <div className={`scene-rotation ${compact ? 'scene-rotation--compact' : ''}`}>
    <div className="scene-rotation-copy"><span className="scene-eyebrow">{locked ? '已锁定' : '自适应随机'}</span>
      <strong>{current}</strong><span>{count} 套参与轮换{locked ? ' · 手动换景仍可用' : editing ? ' · 预览期间暂缓' : !playing ? ' · 等待播放' : ' · 随音乐安排下一幕'}</span>
    </div>
    <div className="scene-actions">
      <button className="scene-button" disabled={!ready} aria-pressed={locked} onClick={() => useSceneStore.getState().setLocked(!locked)}>
        {locked ? <LockKeyhole size={15} /> : <LockKeyholeOpen size={15} />}{locked ? '解除锁定' : '锁定当前'}
      </button>
      <button className="scene-button" disabled={!ready || applying} onClick={() => void nextScene(true)}><Shuffle size={15} />换一个</button>
    </div>
  </div>;
}
