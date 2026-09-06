import { useState, useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useVisualizerStore } from '@/store/visualizerStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { Music } from 'lucide-react';

export default function ImmersiveCover() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playerState = usePlayerStore((s) => s.state);
  const vizMode = useVisualizerStore((s) => s.visualizationMode);
  const moving = useSceneEnvironment(state => state.visible && !state.reducedMotion);
  const [coverFailed, setCoverFailed] = useState(false);

  // Reset coverFailed when cover URL changes (e.g. track skip)
  useEffect(() => setCoverFailed(false), [currentTrack?.coverUrl]);

  const coverUrl = currentTrack?.coverUrl;
  const isCircle = vizMode === 'circle';
  const isPlaying = playerState === 'playing' && moving;

  const showCover = coverUrl && !coverFailed;

  return (
    <div className="relative flex items-center justify-center">
      {showCover ? (
        <>
          <div className="absolute inset-0 scale-125 rounded-full pointer-events-none" style={{ background: 'radial-gradient(ellipse, var(--accent-subtle), transparent 70%)' }} aria-hidden="true" />
          {/* Main cover */}
          <img
            src={coverUrl}
            alt={currentTrack?.name || ''}
            onError={() => setCoverFailed(true)}
            className={`relative w-52 h-52 xl:w-72 xl:h-72 object-cover shadow-[var(--shadow-glow-strong)] ${
              isCircle
                ? `rounded-full animate-cover-rotate ${!isPlaying ? 'animate-cover-rotate-paused' : ''}`
                : 'rounded-2xl'
            }`}
          />
        </>
      ) : (
        <div
          className={`relative w-52 h-52 xl:w-72 xl:h-72 bg-white/5 flex items-center justify-center ${
            isCircle ? 'rounded-full' : 'rounded-2xl'
          }`}
        >
          <Music size={64} className="text-white/20" />
        </div>
      )}
    </div>
  );
}
