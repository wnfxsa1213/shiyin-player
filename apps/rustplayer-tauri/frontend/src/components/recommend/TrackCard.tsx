import { useRef, useState } from 'react';
import { MoreHorizontal, Play } from 'lucide-react';
import { usePlayerStore, type Track } from '@/store/playerStore';
import CoverImage from '@/components/common/CoverImage';
import SourceBadge from '@/components/common/SourceBadge';
import ContextMenu from '@/components/common/ContextMenu';

export default function TrackCard({ track }: { track: Track }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const isCurrent = usePlayerStore(s => s.currentTrack?.id === track.id && s.currentTrack?.source === track.source);
  return (
    <div className={`track-card group ${isCurrent ? 'is-current' : ''}`}
      onContextMenu={e => { e.preventDefault(); playRef.current?.focus(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      <button ref={playRef} onClick={() => { void usePlayerStore.getState().playTrack(track); }}
        aria-label={`播放：${track.name}，${track.artist}`} aria-current={isCurrent ? 'true' : undefined}
        title="播放这首，保留队列" className="track-card-main"
        onKeyDown={e => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.top });
          }
        }}>
        <div className="relative aspect-square w-full">
          <CoverImage src={track.coverUrl} alt="" className="w-full h-full object-cover" />
          <div className="track-card-play"><Play size={20} fill="currentColor" /></div>
          <div className="absolute bottom-1.5 right-1.5"><SourceBadge source={track.source} /></div>
        </div>
        <div className="p-2.5 pr-8 min-w-0">
          <p className="text-sm font-medium truncate" title={track.name}>{track.name}</p>
          <p className="text-xs text-text-secondary truncate mt-0.5" title={track.artist}>{track.artist}</p>
        </div>
      </button>
      <button className="player-icon-button absolute bottom-3 right-1" aria-label={`更多操作：${track.name}`} aria-haspopup="menu" aria-expanded={!!menu}
        onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom }); }}><MoreHorizontal size={17} /></button>
      {menu && <ContextMenu {...menu} track={track} onClose={() => setMenu(null)} />}
    </div>
  );
}
