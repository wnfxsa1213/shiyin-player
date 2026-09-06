import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LocateFixed, ListMusic, Repeat, Repeat1, Shuffle, X, Trash2, Play } from 'lucide-react';
import { usePlayerStore, type PlayMode, type Track } from '@/store/playerStore';

interface Props { isOpen: boolean; onClose(): void }
const keyOf = (track: Track) => `${track.source}:${track.id}`;
const modes: { mode: PlayMode; icon: typeof Repeat; label: string }[] = [
  { mode: 'sequence', icon: Repeat, label: '列表循环' },
  { mode: 'repeat-one', icon: Repeat1, label: '单曲循环' },
  { mode: 'shuffle', icon: Shuffle, label: '随机播放' },
];

export default function QueuePanel({ isOpen, onClose }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const queue = usePlayerStore(s => s.queue);
  const queueIndex = usePlayerStore(s => s.queueIndex);
  const playMode = usePlayerStore(s => s.playMode);
  const nextQueuedKey = usePlayerStore(s => s.nextQueuedKey);
  const state = usePlayerStore(s => s.state);
  const ready = usePlayerStore(s => s.playWhenReady);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const virtualizer = useVirtualizer({
    count: queue.length, enabled: isOpen,
    getScrollElement: () => listRef.current,
    estimateSize: () => 64, overscan: 6,
    getItemKey: index => keyOf(queue[index]),
  });

  const focusIndex = (index: number) => {
    const track = queue[Math.max(0, Math.min(queue.length - 1, index))];
    if (!track) { closeRef.current?.focus(); return; }
    const target = queue.indexOf(track);
    setPendingFocus(keyOf(track));
    virtualizer.scrollToIndex(target, { align: 'auto' });
  };

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    setConfirmClear(false); setNotice('');
    closeRef.current?.focus();
    const current = usePlayerStore.getState();
    if (current.queue[current.queueIndex]) {
      virtualizer.scrollToIndex(current.queueIndex, { align: 'center' });
      setPendingFocus(keyOf(current.queue[current.queueIndex]));
    }
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [isOpen, virtualizer]);

  // A requested row may not exist until the virtualizer has processed the scroll.
  useLayoutEffect(() => {
    if (!isOpen || !pendingFocus) return;
    const button = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-queue-play]') ?? [])
      .find(item => item.dataset.queuePlay === pendingFocus);
    if (button) { button.focus({ preventScroll: true }); setPendingFocus(null); }
  });
  useEffect(() => { if (confirmClear) confirmRef.current?.focus(); }, [confirmClear]);

  if (!isOpen) return null;
  const currentLabel = state === 'loading' ? (ready ? '正在加载' : '等待就绪 · 已暂停')
    : state === 'buffering' ? (ready ? '缓冲中' : '缓冲中 · 已暂停')
    : state === 'playing' ? (ready ? '正在播放' : '正在暂停')
    : state === 'paused' ? (ready ? '正在恢复' : '已暂停') : '当前选择 · 已停止';

  return (
    <aside id="playback-queue" role="dialog" aria-label="播放队列" className="queue-panel"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          if (confirmClear) { setConfirmClear(false); clearRef.current?.focus(); }
          else onClose();
        }
      }}>
      <div className="queue-heading">
        <div><p className="queue-eyebrow">接下来听</p><h2>播放队列 <span>{queue.length}</span></h2></div>
        <button ref={closeRef} onClick={onClose} className="player-icon-button" aria-label="关闭播放队列"><X size={19} /></button>
      </div>
      <div className="queue-modes" role="group" aria-label="播放模式">
        {modes.map(({ mode, icon: Icon, label }) => (
          <button key={mode} onClick={() => usePlayerStore.getState().setPlayMode(mode)} aria-pressed={playMode === mode} className={playMode === mode ? 'is-active' : ''}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>
      <div className="queue-tools">
        <button className="player-text-button" onClick={() => focusIndex(queueIndex)} disabled={queueIndex < 0}><LocateFixed size={14} />定位当前歌曲</button>
        <button ref={clearRef} className="player-text-button" onClick={() => setConfirmClear(true)} disabled={!queue.length}><Trash2 size={14} />清空队列</button>
      </div>
      {confirmClear && (
        <div className="queue-confirm">
          <p>清空 {queue.length} 首歌曲并停止播放？</p>
          <div className="flex gap-2">
            <button ref={confirmRef} className="player-text-button" onClick={() => {
              void usePlayerStore.getState().clearQueue(); setConfirmClear(false); setPendingFocus(null);
              setNotice('队列已清空，播放已停止'); closeRef.current?.focus();
            }}>清空并停止</button>
            <button className="player-text-button" onClick={() => { setConfirmClear(false); clearRef.current?.focus(); }}>取消</button>
          </div>
        </div>
      )}
      {queue.length === 0 ? (
        <div className="queue-empty"><ListMusic size={32} strokeWidth={1.3} /><h3>让喜欢的歌排好队</h3><p>在歌曲的更多菜单中选择<br />“下一首播放”或“加入队列”</p></div>
      ) : (
        <div ref={listRef} className="queue-list" role="list" aria-label="播放队列列表"
          onKeyDown={e => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            const button = (e.target as HTMLElement).closest<HTMLElement>('[data-queue-index]');
            if (!button) return;
            e.preventDefault(); e.stopPropagation();
            const index = Number(button.dataset.queueIndex);
            focusIndex(e.key === 'Home' ? 0 : e.key === 'End' ? queue.length - 1 : index + (e.key === 'ArrowDown' ? 1 : -1));
          }}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map(item => {
              const track = queue[item.index], isCurrent = item.index === queueIndex;
              return (
                <div key={item.key} role="listitem" aria-posinset={item.index + 1} aria-setsize={queue.length}
                  className={`queue-row ${isCurrent ? 'is-current' : ''}`} style={{ transform: `translateY(${item.start}px)` }}>
                  <span className="queue-number" aria-hidden="true">{isCurrent ? <Play size={12} fill="currentColor" /> : item.index + 1}</span>
                  <button data-queue-play={keyOf(track)} data-queue-index={item.index} className="queue-song"
                    aria-label={`播放：${track.name}，${track.artist}`} aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => { void usePlayerStore.getState().playFromQueue(item.index); }}>
                    <span className="queue-song-title" title={track.name}>{track.name}</span>
                    <span className="queue-song-detail" title={track.artist}>{isCurrent ? `${currentLabel} · ` : nextQueuedKey === keyOf(track) ? '下一首 · ' : ''}{track.artist}</span>
                  </button>
                  <button data-queue-index={item.index} className="player-icon-button queue-remove" aria-label={`移除：${track.name}`}
                    title={isCurrent ? '移除当前歌曲并播放下一首' : '从队列移除'} onClick={() => {
                      const following = queue[item.index + 1] ?? queue[item.index - 1];
                      usePlayerStore.getState().removeFromQueue(item.index);
                      setNotice(queue.length === 1 ? '队列已清空，播放已停止' : `已移除「${track.name}」${isCurrent ? '，正在加载下一首' : ''}`);
                      if (following) {
                        setPendingFocus(keyOf(following));
                        virtualizer.scrollToIndex(Math.min(item.index, queue.length - 2), { align: 'auto' });
                      } else { setPendingFocus(null); closeRef.current?.focus(); }
                    }}><X size={15} /></button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="queue-footnote"><span role="status" aria-live="polite">{notice || '单击播放 · 移除当前歌曲会切换下一首'}</span><span>↑ ↓ 移动焦点 · Enter 播放 · Esc 关闭</span></div>
    </aside>
  );
}
