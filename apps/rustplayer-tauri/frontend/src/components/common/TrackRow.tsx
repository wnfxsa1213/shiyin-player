import { memo, useRef, useState } from 'react';
import { MoreHorizontal, Play } from 'lucide-react';
import { Track, usePlayerStore } from '@/store/playerStore';
import { formatTime } from '@/lib/utils';
import ContextMenu from './ContextMenu';

interface Props { track: Track; index: number }

function TrackRow({ track, index }: Props) {
  const isCurrent = usePlayerStore(s => s.currentTrack?.id === track.id && s.currentTrack?.source === track.source);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const play = () => { void usePlayerStore.getState().playTrack(track); };
  const openMenu = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom });
  };
  return (
    <>
      <div
        ref={rowRef} role="listitem" tabIndex={0} aria-current={isCurrent ? 'true' : undefined}
        aria-label={`${track.name}，${track.artist}。Enter 播放，Shift+F10 更多操作`}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!e.repeat) play();
          } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault(); openMenu(e.currentTarget);
          }
        }}
        onClick={e => { if (!(e.target as HTMLElement).closest('button')) rowRef.current?.focus(); }}
        onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) play(); }}
        onContextMenu={e => { e.preventDefault(); rowRef.current?.focus(); setMenu({ x: e.clientX, y: e.clientY }); }}
        className={`track-row group ${isCurrent ? 'is-current' : ''}`}
      >
        <div className="track-row-number">
          <span aria-hidden="true">{isCurrent ? '♪' : index}</span>
          <button className="track-row-play" onClick={play} aria-label={`播放：${track.name}`} title="播放这首，保留队列"><Play size={15} fill="currentColor" /></button>
        </div>
        <div className="flex-1 min-w-0 px-3">
          <div className={`truncate text-sm font-medium ${isCurrent ? 'text-accent' : ''}`} title={track.name}>{track.name}</div>
          <div className="truncate text-xs text-text-secondary" title={track.artist}>{track.artist}</div>
        </div>
        <div className="w-1/4 hidden md:block text-sm text-text-secondary truncate px-3" title={track.album}>{track.album}</div>
        <div className="w-14 text-right text-xs text-text-secondary tabular-nums">{formatTime(track.durationMs)}</div>
        <button className="player-icon-button ml-2" aria-label={`更多操作：${track.name}`} aria-haspopup="menu" aria-expanded={!!menu}
          onClick={e => openMenu(e.currentTarget)}><MoreHorizontal size={18} /></button>
      </div>
      {menu && <ContextMenu {...menu} track={track} onClose={() => setMenu(null)} />}
    </>
  );
}

export default memo(TrackRow);
