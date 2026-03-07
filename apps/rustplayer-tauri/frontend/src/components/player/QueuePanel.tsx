import { useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePlayerStore, type PlayMode } from '@/store/playerStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Repeat, Repeat1, Shuffle, X, Trash2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const modeIcons: { mode: PlayMode; icon: typeof Repeat; label: string }[] = [
  { mode: 'sequence', icon: Repeat, label: '列表循环' },
  { mode: 'repeat-one', icon: Repeat1, label: '单曲循环' },
  { mode: 'shuffle', icon: Shuffle, label: '随机播放' },
];

export default function QueuePanel({ isOpen, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const playMode = usePlayerStore((s) => s.playMode);
  const playFromQueue = usePlayerStore((s) => s.playFromQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const setPlayMode = usePlayerStore((s) => s.setPlayMode);
  const [confirmClear, setConfirmClear] = useState(false);

  const virtualizer = useVirtualizer({
    count: queue.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 58,
    overscan: 6,
    getItemKey: (index) => `${queue[index]?.source}-${queue[index]?.id}-${index}`,
  });

  useFocusTrap(containerRef, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="播放队列"
      aria-modal="true"
      tabIndex={-1}
      className="fixed right-0 top-0 bottom-20 w-80 z-40 bg-bg-primary/95 glass border-l border-border-primary flex flex-col animate-slide-in-right overscroll-contain"
    >      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-secondary">
        <h2 className="text-sm font-semibold">播放队列 ({queue.length})</h2>
        <div className="flex items-center gap-1">
          {confirmClear ? (
            <>
              <button
                onClick={() => {
                  clearQueue();
                  setConfirmClear(false);
                }}
                className="px-2 py-1 rounded text-xs bg-error/20 text-error hover:bg-error/30 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                确认
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="px-2 py-1 rounded text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                取消
              </button>
            </>
          ) : (
            <button
              onClick={() => queue.length > 0 && setConfirmClear(true)}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              aria-label="清空队列"
            >
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none" aria-label="关闭">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Play mode toggle */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border-secondary">
        {modeIcons.map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            onClick={() => setPlayMode(mode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors duration-200 cursor-pointer ${
              playMode === mode
                ? 'bg-accent-subtle text-accent font-medium'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
            }`}
            aria-label={label}
            title={label}
          >
            <Icon size={14} strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>
      {/* Queue list */}
      {queue.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
          队列为空
        </div>
      ) : (
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto min-h-0"
          role="list"
          aria-label="播放队列列表"
        >
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const track = queue[vItem.index];
              const isCurrent = vItem.index === queueIndex;

              return (
                <div
                  key={vItem.key}
                  role="listitem"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  <div
                    className={`group flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 ${
                      isCurrent ? 'bg-accent-subtle' : 'hover:bg-bg-hover'
                    }`}
                  >
                    <span className="w-6 text-xs text-text-tertiary text-center tabular-nums">
                      {isCurrent ? <span className="text-accent">&#9835;</span> : vItem.index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => playFromQueue(vItem.index)}
                      className="flex-1 min-w-0 text-left cursor-pointer bg-transparent border-0 p-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded"
                    >
                      <div className={`text-sm truncate ${isCurrent ? 'text-accent font-medium' : ''}`} title={track.name}>{track.name}</div>
                      <div className="text-xs text-text-tertiary truncate" title={track.artist}>{track.artist}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromQueue(vItem.index)}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none p-1 rounded text-text-tertiary hover:text-error transition-[opacity,color] cursor-pointer"
                      aria-label="移除"
                    >
                      <X size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
