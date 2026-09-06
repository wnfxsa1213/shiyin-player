import { useState, useRef } from 'react';
import { useAutoHide } from '@/hooks/useAutoHide';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useNavigate } from 'react-router-dom';
import { useSceneStore } from '@/store/sceneStore';
import { usePlayerStore } from '@/store/playerStore';
import SceneSurface from '@/components/scenes/SceneSurface';
import SceneRotationControls from '@/components/scenes/SceneRotationControls';
import ImmersiveCover from '@/components/player/ImmersiveCover';
import ImmersiveTrackInfo from '@/components/player/ImmersiveTrackInfo';
import PlaybackStatus from '@/components/player/PlaybackStatus';
import ImmersiveLyrics from '@/components/player/ImmersiveLyrics';
import ImmersiveControls from '@/components/player/ImmersiveControls';


interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ImmersiveFMPanel({ isOpen, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scene = useSceneStore(state => state.current);
  const hasFailure = usePlayerStore(state => state.playbackFailure !== null);
  const navigate = useNavigate();
  const [controlsFocused, setControlsFocused] = useState(false);
  const { visible: controlsVisible, onMouseMove, onMouseDown } = useAutoHide(3000, isOpen);

  useFocusTrap(panelRef, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="沉浸式播放"
      tabIndex={-1}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onKeyDown={onMouseMove}
      className="fixed inset-0 z-[60] bg-black overflow-hidden animate-fade-in"
      style={{ cursor: controlsVisible || controlsFocused || hasFailure ? undefined : 'none' }}
    >
      {/* Background: visualizer + particles */}
      <SceneSurface scene={scene} />

      {/* Main content: cover + track info on left, lyrics on right */}
      <div className="relative z-10 flex h-full">
        {/* Left side: cover + info */}
        <div className="w-1/2 min-w-0 flex flex-col items-center justify-center p-6 lg:p-12">
          <ImmersiveCover />
          <ImmersiveTrackInfo />
          <div className="immersive-playback-feedback mb-3"><PlaybackStatus /></div>
          <SceneRotationControls compact />
          <button className="mt-3 text-xs text-white/70 hover:text-white rounded p-2 focus-visible:ring-2 focus-visible:ring-accent" onClick={() => { onClose(); navigate('/scenes'); }}>打开视觉场景</button>
        </div>

        {/* Right side: lyrics */}
        <div className="w-1/2 min-w-0 flex flex-col">
          <ImmersiveLyrics />
        </div>
      </div>

      {/* Bottom controls overlay */}
      <ImmersiveControls visible={controlsVisible || controlsFocused || hasFailure} onClose={onClose} onFocusChange={setControlsFocused} />
    </div>
  );
}
