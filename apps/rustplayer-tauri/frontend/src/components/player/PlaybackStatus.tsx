import { Circle, LoaderCircle, Pause, Radio } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';

export default function PlaybackStatus() {
  const state = usePlayerStore(s => s.state);
  const track = usePlayerStore(s => s.currentTrack);
  const ready = usePlayerStore(s => s.playWhenReady);
  const buffering = usePlayerStore(s => s.bufferingPercent);
  const retries = usePlayerStore(s => s.retryCount);
  const listening = usePlayerStore(s => s.listening);
  const hasQueue = usePlayerStore(s => s.queue.length > 0);
  let label = hasQueue ? '队列待播放' : '选择一首歌，开始聆听';
  let busy = false;
  if (track) {
    if (state === 'loading' || state === 'buffering') {
      busy = ready;
      const operation = state === 'buffering'
        ? `缓冲中 ${Math.max(0, Math.min(100, Math.round(buffering)))}%`
        : retries > 0 ? `正在重试 ${retries}/2` : '正在加载';
      label = ready ? operation : `已暂停 · ${state === 'loading' ? '就绪后保持暂停' : operation}`;
      if (listening.track && (listening.track.id !== track.id || listening.track.source !== track.source) && listening.state === 'playing') {
        label += ` ·「${listening.track.name}」仍在播放`;
      }
    } else if (state === 'playing') label = ready ? '正在播放' : '正在暂停…';
    else if (state === 'paused') label = ready ? '正在恢复…' : '已暂停';
    else label = '已停止';
  }
  const Icon = busy ? LoaderCircle : state === 'playing' && ready ? Radio : track && !ready ? Pause : Circle;
  return (
    <div className={`playback-status ${busy ? 'is-busy' : ''}`} title={label}>
      <Icon size={12} className={busy ? 'playback-spinner' : ''} aria-hidden="true" />
      <span role="status" aria-live="polite" aria-atomic="true" className="truncate">{label}<span className="sr-only">{track ? `：${track.name}，${track.artist}` : ''}</span></span>
    </div>
  );
}
