import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { ipc } from '@/lib/ipc';
import SpectrumVisualizer from '@/components/player/SpectrumVisualizer';
import PlaybackProgress from '@/components/player/PlaybackProgress';
import { Music, SkipBack, Play, Pause, SkipForward, Music2, Volume2, ListMusic } from 'lucide-react';

export default function PlayerBar({ lyricsOpen, onToggleLyrics, onToggleQueue }: { lyricsOpen: boolean, onToggleLyrics: () => void, onToggleQueue: () => void }) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const state = usePlayerStore((s) => s.state);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const queue = usePlayerStore((s) => s.queue);
  const [coverFailed, setCoverFailed] = useState(false);

  const centerRef = useRef<HTMLDivElement>(null);
  const [centerWidth, setCenterWidth] = useState(600);

  // Reset cover error state when track changes
  useEffect(() => {
    setCoverFailed(false);
  }, [currentTrack?.id, currentTrack?.source]);

  useEffect(() => {
    if (!centerRef.current) return;
    const obs = new ResizeObserver(([e]) => setCenterWidth(e.contentRect.width));
    obs.observe(centerRef.current);
    return () => obs.disconnect();
  }, []);

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    ipc.setVolume(val);
  };

  const isPlaying = state === 'playing';

  return (
    <footer
      className="h-20 bg-bg-primary/80 glass flex-shrink-0 fixed bottom-0 w-full z-50 border-t border-border-primary flex items-center justify-between px-6 transition-[background-color,border-color] duration-700"
      aria-label="播放控制"
    >
      {/* Spectrum background layer — isolated overflow-hidden wrapper */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 opacity-50 transition-opacity duration-700">
          <SpectrumVisualizer width={centerWidth} height={60} />
        </div>
      </div>

      {/* Left: Track Info & Cover */}
      <div className="relative flex items-center w-1/4 min-w-[180px]">
        {currentTrack ? (
          <>
            <button className="relative z-50 group w-12 h-12 flex-shrink-0 bg-transparent border-0 p-0 cursor-pointer" onClick={onToggleLyrics} aria-label="展开歌词">
              {!lyricsOpen && (
                currentTrack.coverUrl && !coverFailed ? (
                  <img
                    src={currentTrack.coverUrl}
                    alt=""
                    width={48}
                    height={48}
                    className={`w-full h-full shadow-sm object-cover ${isPlaying ? 'rounded-full' : 'rounded-lg'}`}
                    onError={() => setCoverFailed(true)}
                  />
                ) : (
                  <div
                    className={`w-full h-full bg-bg-secondary flex items-center justify-center ${isPlaying ? 'rounded-full' : 'rounded-lg'}`}
                  >
                    <Music size={20} strokeWidth={1.5} className="text-text-tertiary" />
                  </div>
                )
              )}
              {lyricsOpen && (
                <div className={`w-full h-full bg-bg-secondary/50 flex items-center justify-center ${isPlaying ? 'rounded-full' : 'rounded-lg'}`}>
                  <Music2 size={16} className="text-text-tertiary" />
                </div>
              )}
              {!lyricsOpen && (
                <div className={`absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center ${isPlaying ? 'rounded-full' : 'rounded-lg'}`}>
                  <Music2 size={16} className="text-white" />
                </div>
              )}
            </button>

            <div className="ml-3 min-w-0 overflow-hidden">
              <div className="text-sm font-medium truncate" title={currentTrack.name}>{currentTrack.name}</div>
              <div className="text-xs text-text-secondary truncate" title={currentTrack.artist}>{currentTrack.artist}</div>
            </div>
          </>
        ) : (
          <span className="text-sm text-text-tertiary">未在播放</span>
        )}
      </div>

      {/* Center: Controls & Transient Progress */}
      <div ref={centerRef} className="relative flex flex-col items-center w-1/2 max-w-2xl">
        <div className="flex items-center gap-6 mb-1">
          <button
            onClick={() => queue.length > 0 && usePlayerStore.getState().playPrev()}
            disabled={queue.length === 0}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200 ${
              queue.length === 0
                ? 'text-text-tertiary opacity-40 cursor-not-allowed'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer'
            }`}
            aria-label="上一首"
          >
            <SkipBack size={20} strokeWidth={1.5} />
          </button>

          <button
            onClick={() => currentTrack && ipc.togglePlayback()}
            disabled={!currentTrack}
            className={`w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center transition-[transform,box-shadow,opacity] duration-500 shadow-glow ${
              !currentTrack
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:shadow-glow-strong active:scale-95 cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent focus-visible:outline-none'
            }`}
            style={{ backgroundColor: 'var(--accent)' }}
            aria-label={state === 'playing' ? '暂停' : '播放'}
          >
            {state === 'playing' ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" className="ml-0.5" />
            )}
          </button>

          <button
            onClick={() => queue.length > 0 && usePlayerStore.getState().playNext()}
            disabled={queue.length === 0}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200 ${
              queue.length === 0
                ? 'text-text-tertiary opacity-40 cursor-not-allowed'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer'
            }`}
            aria-label="下一首"
          >
            <SkipForward size={20} strokeWidth={1.5} />
          </button>
        </div>

        {/* 剥离出的无渲染高性能进度条 */}
        <PlaybackProgress />
      </div>

      {/* Right: Volume & Queue */}
      <div className="relative flex items-center justify-end w-1/4 min-w-[180px] gap-3">
        <button onClick={onToggleQueue} className="text-text-secondary hover:text-text-primary transition-colors duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded p-1" aria-label="播放队列">
          <ListMusic size={20} strokeWidth={1.5} />
        </button>
        <Volume2 size={16} strokeWidth={1.5} className="text-text-tertiary flex-shrink-0" aria-hidden="true" />
        <input
          type="range"
          name="volume"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={handleVolume}
          className="w-24"
          aria-label="音量"
          title={`${Math.round(volume * 100)}%`}
        />
        <span className="text-xs text-text-tertiary w-8 tabular-nums">{Math.round(volume * 100)}%</span>
      </div>
    </footer>
  );
}
