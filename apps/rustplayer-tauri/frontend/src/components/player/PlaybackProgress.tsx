import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { ipc } from '@/lib/ipc';
import { formatTime } from '@/lib/utils';

export default function PlaybackProgress() {
  const durationMs = usePlayerStore((s) => s.durationMs);
  const timeSpanRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingValueRef = useRef<number>(0);

  const isDraggingRef = useRef(false);

  useEffect(() => {
    // 使用 subscribe 绕过 React 渲染，直接更新 DOM
    const unsubscribe = usePlayerStore.subscribe(
      (state) => {
        if (isDraggingRef.current) return; // 拖拽时忽略 store 的更新

        const pos = state.positionMs;
        if (timeSpanRef.current) {
          timeSpanRef.current.textContent = formatTime(pos);
        }
        if (inputRef.current) {
          inputRef.current.value = pos.toString();
        }
      }
    );
    return unsubscribe;
  }, []);

  const handleMouseDown = () => {
    isDraggingRef.current = true;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    draggingValueRef.current = val;
    if (timeSpanRef.current) {
      timeSpanRef.current.textContent = formatTime(val);
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    ipc.seek(draggingValueRef.current);
    // 这里我们依然通过 setState 触发一次真实同步，但主要拖拽和播放过程的 UI 已被 ref 托管
    usePlayerStore.setState({ positionMs: draggingValueRef.current });
  };

  return (
    <div className="flex items-center gap-2 w-full text-xs text-text-secondary">
      <span ref={timeSpanRef} className="font-mono tabular-nums">
        {formatTime(usePlayerStore.getState().positionMs)}
      </span>
      <input
        ref={inputRef}
        type="range"
        min={0}
        max={durationMs || 100}
        defaultValue={usePlayerStore.getState().positionMs}
        onMouseDown={handleMouseDown}
        onChange={handleChange}
        onMouseUp={handleMouseUp}
        className="flex-1"
        aria-label="播放进度"
      />
      <span className="font-mono tabular-nums">{formatTime(durationMs)}</span>
    </div>
  );
}