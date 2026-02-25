import { useState, useRef } from 'react';
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
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const playMode = usePlayerStore((s) => s.playMode);
  const playFromQueue = usePlayerStore((s) => s.playFromQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const setPlayMode = usePlayerStore((s) => s.setPlayMode);
  const [confirmClear, setConfirmClear] = useState(false);

  useFocusTrap(containerRef, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="播放队列"
      aria-modal="true"
      tabIndex={-1}
      className="fixed right-0 top-0 bottom-20 w-80 z-40 bg-bg-primary/95 glass border-l border-border-primary flex flex-col animate-slide-in-right"
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all duration-200 cursor-pointer ${
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
      <ul className="flex-1 overflow-y-auto list-none m-0 p-0" role="list">
        {queue.length === 0 ? (
          <li className="text-center py-12 text-text-tertiary text-sm">队列为空</li>
        ) : (
          queue.map((track, i) => (
            <li
              key={`${track.source}-${track.id}-${i}`}
              className={`group flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 ${
                i === queueIndex ? 'bg-accent-subtle' : 'hover:bg-bg-hover'
              }`}
            >
              <span className="w-6 text-xs text-text-tertiary text-center tabular-nums">
                {i === queueIndex ? <span className="text-accent">&#9835;</span> : i + 1}
              </span>
              <button
                onClick={() => playFromQueue(i)}
                className="flex-1 min-w-0 text-left cursor-pointer bg-transparent border-0 p-0"
              >
                <div className={`text-sm truncate ${i === queueIndex ? 'text-accent font-medium' : ''}`}>{track.name}</div>
                <div className="text-xs text-text-tertiary truncate">{track.artist}</div>
              </button>
              <button
                onClick={() => removeFromQueue(i)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-tertiary hover:text-error transition-all cursor-pointer"
                aria-label="移除"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
