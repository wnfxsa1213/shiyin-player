import { AlertCircle, RotateCcw, X } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';

export default function PlaybackFailure({ onAction }: { onAction(): void }) {
  const failure = usePlayerStore(s => s.playbackFailure);
  if (!failure) return null;
  return (
    <div className="playback-failure">
      <AlertCircle size={17} aria-hidden="true" />
      <p role="status" aria-live="polite" className="min-w-0 flex-1" title={`无法播放「${failure.track.name}」 · ${failure.message}`}>
        <strong>无法播放「{failure.track.name}」</strong><span> · {failure.message}</span>
      </p>
      <button className="player-text-button" onClick={() => { void usePlayerStore.getState().retryPlayback(); onAction(); }}><RotateCcw size={14} />重试这首</button>
      <button className="player-icon-button" aria-label="关闭播放失败提示" onClick={() => { usePlayerStore.getState().dismissPlaybackFailure(); onAction(); }}><X size={16} /></button>
    </div>
  );
}
