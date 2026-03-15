import type { Track } from '@/store/playerStore';
import { usePlayerStore } from '@/store/playerStore';
import CoverImage from '@/components/common/CoverImage';
import SourceBadge from '@/components/common/SourceBadge';

interface TrackCardProps {
  track: Track;
  tracks: Track[];
  index: number;
}

export default function TrackCard({ track, tracks, index }: TrackCardProps) {
  const handlePlay = () => {
    const store = usePlayerStore.getState();
    store.clearQueue();
    store.addToQueue(tracks);
    store.playFromQueue(index);
  };

  return (
    <button
      onClick={handlePlay}
      className="group flex flex-col w-[160px] flex-shrink-0 rounded-lg bg-[var(--bg-secondary)]
        hover:bg-[var(--bg-hover)] transition-all duration-200 overflow-hidden cursor-pointer
        hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--accent)]
        focus-visible:outline-none text-left"
    >
      <div className="relative aspect-square w-full">
        <CoverImage src={track.coverUrl} alt={track.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center
            opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="black">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        <div className="absolute bottom-1.5 right-1.5">
          <SourceBadge source={track.source} />
        </div>
      </div>
      <div className="p-2.5 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{track.name}</p>
        <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{track.artist}</p>
      </div>
    </button>
  );
}
