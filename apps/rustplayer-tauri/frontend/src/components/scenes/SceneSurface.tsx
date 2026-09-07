import { useEffect, useRef, useState } from 'react';
import { backgroundUrl, prepareImage } from '@/lib/scenes/assets';
import { sceneGradient, type VisualScene } from '@/lib/scenes/model';
import { createSceneRenderer, spectrumEnergy } from '@/lib/scenes/renderer';
import { useSceneStore } from '@/store/sceneStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { usePlayerStore } from '@/store/playerStore';
import { useVisualizerStore, spectrumDataRef } from '@/store/visualizerStore';
import { useToastStore } from '@/store/toastStore';
import { hasVisualPlayback } from '@/lib/scenes/spectrum';

interface Props {
  scene: VisualScene;
  variant?: 'main' | 'immersive' | 'preview';
  motion?: 'playback' | 'preview';
  active?: boolean;
}
interface Background { scene: VisualScene; url: string | null; }

export default function SceneSurface({ scene, variant = 'immersive', motion = 'playback', active = true }: Props) {
  const assets = useSceneStore(state => state.assets);
  const cover = usePlayerStore(state => state.listening.track?.coverUrl);
  const playing = usePlayerStore(state => hasVisualPlayback(state));
  const visible = useSceneEnvironment(state => state.visible);
  const reduced = useSceneEnvironment(state => state.reducedMotion);
  const enabled = useVisualizerStore(state => state.enabled && state.showParticles);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createSceneRenderer>>(null);
  const [inView, setInView] = useState(true);
  const [background, setBackground] = useState<Background>({ scene, url: null });
  const [previous, setPrevious] = useState<Background | null>(null);
  const shown = useRef(background);
  const url = backgroundUrl(scene, assets, cover);
  // Preview scheduling is independent of the backdrop's presentation style.
  const running = active && inView && visible && !reduced && enabled && (playing || motion === 'preview');

  useEffect(() => {
    let alive = true;
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const commit = (resolved: string | null) => {
      if (!alive) return;
      const next = { scene, url: resolved };
      setPrevious(reduced ? null : shown.current); shown.current = next; setBackground(next);
      timer = setTimeout(() => setPrevious(null), reduced ? 0 : 400);
    };
    if (url) void prepareImage(url, request.signal).then(() => commit(url), () => {
      if (alive) { commit(null); useToastStore.getState().addToast('info', '背景暂时不可用，已显示场景渐变'); }
    });
    else {
      commit(null);
      if (scene.background.kind === 'image') useToastStore.getState().addToast('info', '背景素材已丢失，已显示场景渐变；可在场景库重新导入');
    }
    return () => { alive = false; request.abort(); clearTimeout(timer); };
  }, [scene, url, reduced]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? false));
    observer.observe(element); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canvas.current || !enabled) return;
    const instance = createSceneRenderer(canvas.current, background.scene, variant === 'main', () => {
      const player = usePlayerStore.getState();
      if (!hasVisualPlayback(player, useSceneEnvironment.getState().visible)
        || spectrumDataRef.playbackId !== player.listening.playbackId || !spectrumDataRef.receivedAt
        || performance.now() - spectrumDataRef.receivedAt > 350) return 0;
      return spectrumEnergy(spectrumDataRef.current);
    });
    renderer.current = instance;
    const observer = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect;
      if (size) instance?.resize(size.width, size.height);
    });
    observer.observe(host.current!);
    return () => { observer.disconnect(); instance?.dispose(); renderer.current = null; };
  }, [background.scene, enabled, variant]);
  useEffect(() => { renderer.current?.setActive(running); }, [running, background.scene, enabled, variant]);

  const layer = (value: Background) => <div className="scene-image" style={{ background: sceneGradient(value.scene) }}>
    {value.url && <img src={value.url} alt="" draggable={false} />}
  </div>;
  return <div ref={host} className={`scene-surface scene-surface--${variant}`} aria-hidden="true">
    {layer(background)}
    {previous && <div className="scene-outgoing">{layer(previous)}</div>}
    {enabled && <canvas ref={canvas} className="scene-canvas" />}
    <div className="scene-wash" />
  </div>;
}
