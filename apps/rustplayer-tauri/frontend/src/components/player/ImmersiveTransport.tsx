import { SkipBack, Play, Pause, SkipForward } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';

const buttonClass = 'w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:text-white/30 disabled:cursor-default focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';

export default function ImmersiveTransport() {
  const ready = usePlayerStore(state => state.playWhenReady);
  const hasTrack = usePlayerStore(state => state.currentTrack !== null);
  const hasQueue = usePlayerStore(state => state.queue.length > 0);

  return (
    <div className="flex items-center gap-4" role="group" aria-label="沉浸播放控制">
      <button className={buttonClass} disabled={!hasQueue} aria-label="上一首"
        onClick={() => { void usePlayerStore.getState().playPrev(); }}>
        <SkipBack size={22} strokeWidth={1.5} />
      </button>
      <button disabled={!hasTrack && !hasQueue} aria-label={ready ? '暂停' : '播放'}
        className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-default focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        onClick={() => { void usePlayerStore.getState().togglePlayback(); }}>
        {ready ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
      </button>
      <button className={buttonClass} disabled={!hasQueue} aria-label="下一首"
        onClick={() => { void usePlayerStore.getState().playNext(); }}>
        <SkipForward size={22} strokeWidth={1.5} />
      </button>
    </div>
  );
}
