import { memo, useState } from 'react';
import { Track, usePlayerStore } from '@/store/playerStore';
import { formatTime } from '@/lib/utils';
import ContextMenu from './ContextMenu';

interface Props {
  track: Track;
  index: number;
}

function TrackRow({ track, index }: Props) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isCurrent = currentTrack?.id === track.id && currentTrack?.source === track.source;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handlePlay = () => {
    const store = usePlayerStore.getState();
    store.addToQueue([track]);
    const updatedQueue = usePlayerStore.getState().queue;
    const idx = updatedQueue.findIndex((t) => t.id === track.id && t.source === track.source);
    if (idx >= 0) store.playFromQueue(idx);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        className={`group relative flex items-center px-4 py-2.5 rounded-lg transition-colors duration-200 cursor-pointer ${
          isCurrent
            ? 'bg-accent-subtle'
            : 'hover:bg-bg-hover'
        }`}
        onDoubleClick={handlePlay}
        onContextMenu={handleContextMenu}
      >
        {isCurrent && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-gradient-accent" />
        )}
        <div className="w-10 text-center text-text-tertiary text-sm">
          <span className="group-hover:hidden">
            {isCurrent ? <span className="text-accent">&#9835;</span> : index}
          </span>
          <button onClick={handlePlay} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handlePlay(); } }} className="hidden group-hover:inline text-accent hover:text-accent-hover cursor-pointer" aria-label="播放">
            &#9654;
          </button>
        </div>
        <div className="flex-1 min-w-0 px-3">
          <div className={`truncate text-sm font-medium ${isCurrent ? 'text-accent' : ''}`} title={track.name}>
            {track.name}
          </div>
          <div className="truncate text-xs text-text-secondary" title={track.artist}>{track.artist}</div>
        </div>
        <div className="w-1/4 hidden md:block text-sm text-text-secondary truncate px-3" title={track.album}>{track.album}</div>
        <div className="w-16 text-right text-xs text-text-tertiary font-mono tabular-nums">{formatTime(track.durationMs)}</div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} track={track} onClose={() => setMenu(null)} />}
    </>
  );
}

export default memo(TrackRow);
