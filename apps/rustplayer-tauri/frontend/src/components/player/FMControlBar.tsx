import { usePlayerStore } from '@/store/playerStore';
import { useFmStore } from '@/store/fmStore';
import { ipc } from '@/lib/ipc';
import { ThumbsDown, SkipBack, Play, Pause, SkipForward, Heart } from 'lucide-react';

const btnBase =
  'w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';

export default function FMControlBar() {
  const state = usePlayerStore((s) => s.state);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const fmDislike = useFmStore((s) => s.dislike);
  const fmPlayNext = useFmStore((s) => s.playNext);

  const isPlaying = state === 'playing';

  return (
    <div className="flex items-center gap-4">
      {/* Dislike (skip and mark as dislike) */}
      <button
        onClick={() => fmDislike()}
        disabled={!currentTrack}
        className={`${btnBase} ${
          !currentTrack
            ? 'text-white/30 cursor-not-allowed'
            : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        aria-label="不喜欢"
      >
        <ThumbsDown size={20} strokeWidth={1.5} />
      </button>

      {/* Previous */}
      <button
        onClick={() => usePlayerStore.getState().playPrev()}
        disabled={!currentTrack}
        className={`${btnBase} ${
          !currentTrack
            ? 'text-white/30 cursor-not-allowed'
            : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        aria-label="上一首"
      >
        <SkipBack size={22} strokeWidth={1.5} />
      </button>

      {/* Play / Pause */}
      <button
        onClick={() => currentTrack && ipc.togglePlayback()}
        disabled={!currentTrack}
        className={`w-14 h-14 rounded-full bg-white text-black flex items-center justify-center transition-[transform,opacity] duration-300 ${
          !currentTrack
            ? 'opacity-40 cursor-not-allowed'
            : 'hover:scale-105 active:scale-95 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'
        }`}
        aria-label={isPlaying ? '暂停' : '播放'}
      >
        {isPlaying ? (
          <Pause size={22} fill="currentColor" />
        ) : (
          <Play size={22} fill="currentColor" className="ml-0.5" />
        )}
      </button>

      {/* Next (FM next) */}
      <button
        onClick={() => fmPlayNext()}
        disabled={!currentTrack}
        className={`${btnBase} ${
          !currentTrack
            ? 'text-white/30 cursor-not-allowed'
            : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        aria-label="下一首"
      >
        <SkipForward size={22} strokeWidth={1.5} />
      </button>

      {/* Like */}
      <button
        disabled={!currentTrack}
        className={`${btnBase} ${
          !currentTrack
            ? 'text-white/30 cursor-not-allowed'
            : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        aria-label="喜欢"
      >
        <Heart size={20} strokeWidth={1.5} />
      </button>
    </div>
  );
}
