import { useState, useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useVisualizerStore } from '@/store/visualizerStore';
import { Music } from 'lucide-react';

export default function ImmersiveCover() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playerState = usePlayerStore((s) => s.state);
  const vizMode = useVisualizerStore((s) => s.visualizationMode);
  const [coverFailed, setCoverFailed] = useState(false);

  // Reset coverFailed when cover URL changes (e.g. track skip)
  useEffect(() => setCoverFailed(false), [currentTrack?.coverUrl]);

  const coverUrl = currentTrack?.coverUrl;
  const isCircle = vizMode === 'circle';
  const isPlaying = playerState === 'playing';

  const showCover = coverUrl && !coverFailed;

  return (
    <div className="relative flex items-center justify-center">
      {showCover ? (
        <>
          {/* Glow layer — uses a tiny scaled-up cover instead of real-time blur-3xl
              to avoid expensive GPU compositing on WebKitGTK */}
          <img
            src={coverUrl}
            alt=""
            className="absolute w-full h-full opacity-30 scale-150 pointer-events-none"
            style={{ imageRendering: 'pixelated', filter: 'blur(8px)' }}
            aria-hidden="true"
            width={32}
            height={32}
          />
          {/* Main cover */}
          <img
            src={coverUrl}
            alt={currentTrack?.name || ''}
            onError={() => setCoverFailed(true)}
            className={`relative w-72 h-72 object-cover shadow-[var(--shadow-glow-strong)] ${
              isCircle
                ? `rounded-full animate-cover-rotate ${!isPlaying ? 'animate-cover-rotate-paused' : ''}`
                : 'rounded-2xl'
            }`}
          />
        </>
      ) : (
        <div
          className={`relative w-72 h-72 bg-white/5 flex items-center justify-center ${
            isCircle ? 'rounded-full' : 'rounded-2xl'
          }`}
        >
          <Music size={64} className="text-white/20" />
        </div>
      )}
    </div>
  );
}
