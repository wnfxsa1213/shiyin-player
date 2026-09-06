import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { SkipBack, Play, Pause, SkipForward, Volume2, ListMusic, Sparkles } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { useUiStore } from '@/store/uiStore';
import CoverImage from '@/components/common/CoverImage';
import PlaybackProgress from '@/components/player/PlaybackProgress';
import PlaybackStatus from '@/components/player/PlaybackStatus';
import PlaybackFailure from '@/components/player/PlaybackFailure';

interface Props {
  lyricsOpen: boolean;
  queueOpen: boolean;
  onToggleLyrics(): void;
  onToggleQueue(): void;
}

export default function PlayerBar({ lyricsOpen, queueOpen, onToggleLyrics, onToggleQueue }: Props) {
  const immersiveOpen = useUiStore(s => s.immersiveOpen);
  const track = usePlayerStore(s => s.currentTrack);
  const ready = usePlayerStore(s => s.playWhenReady);
  const volume = usePlayerStore(s => s.volume);
  const count = usePlayerStore(s => s.queue.length);
  const playRef = useRef<HTMLButtonElement>(null);
  return (
    <footer className="player-bar" aria-label="播放控制">
      {!immersiveOpen && <PlaybackFailure onAction={() => playRef.current?.focus()} />}
      <div className="player-bar-main">
        <div className="player-track">
          <button className="player-cover" disabled={!track} onClick={onToggleLyrics} aria-label={lyricsOpen ? '收起播放详情' : '打开播放详情'} aria-expanded={lyricsOpen} title="打开播放详情">
            <CoverImage src={track?.coverUrl} alt="" className="w-full h-full object-cover" fallbackClassName="w-full h-full bg-bg-secondary flex items-center justify-center" iconSize={22} />
          </button>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" title={track?.name}>{track?.name || (count ? '准备好下一段旋律' : '未在播放')}</div>
            <div className="text-xs text-text-secondary truncate" title={track?.artist}>{track?.artist || (count ? `队列中有 ${count} 首歌曲` : '从搜索或推荐中选择歌曲')}</div>
            {!immersiveOpen && <PlaybackStatus />}
          </div>
        </div>
        <div className="player-transport">
          <div className="flex items-center justify-center gap-5">
            <button className="player-icon-button" onClick={() => { void usePlayerStore.getState().playPrev(); }} disabled={!count} aria-label="上一首"><SkipBack size={20} /></button>
            <button ref={playRef} className="player-play-button" onClick={() => { void usePlayerStore.getState().togglePlayback(); }} disabled={!track && !count} aria-label={ready ? '暂停' : '播放'}>
              {ready ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
            </button>
            <button className="player-icon-button" onClick={() => { void usePlayerStore.getState().playNext(); }} disabled={!count} aria-label="下一首"><SkipForward size={20} /></button>
          </div>
          {!immersiveOpen && <PlaybackProgress />}
        </div>
        <div className="player-tools">
          <Link to="/scenes" className="player-icon-button" aria-label="打开视觉场景" title="视觉场景"><Sparkles size={18} /></Link>
          <button onClick={onToggleQueue} className={`player-queue-toggle ${queueOpen ? 'is-active' : ''}`} aria-label={`播放队列，${count} 首`} aria-expanded={queueOpen} aria-controls="playback-queue" title="播放队列">
            <ListMusic size={19} /><span className="tabular-nums">{count}</span>
          </button>
          <div className="player-volume">
            <Volume2 size={16} aria-hidden="true" />
            <input type="range" name="volume" min={0} max={1} step={0.01} value={volume}
              style={{ '--progress': `${volume * 100}%` } as React.CSSProperties}
              onChange={e => usePlayerStore.getState().setVolume(Number(e.target.value))} aria-label="音量" aria-valuetext={`${Math.round(volume * 100)}%`} title={`音量 ${Math.round(volume * 100)}%`} />
          </div>
        </div>
      </div>
    </footer>
  );
}
