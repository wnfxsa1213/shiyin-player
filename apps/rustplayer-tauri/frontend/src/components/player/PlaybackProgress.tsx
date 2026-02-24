import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { ipc } from '@/lib/ipc';
import { formatTime } from '@/lib/utils';

export default function PlaybackProgress() {
  const timeSpanRef = useRef<HTMLSpanElement>(null);
  const durationSpanRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingValueRef = useRef<number>(0);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = usePlayerStore.subscribe((state) => {
      if (isDraggingRef.current) return;

      const pos = state.positionMs;
      const dur = state.durationMs;

      if (timeSpanRef.current) {
        timeSpanRef.current.textContent = formatTime(pos);
      }
      if (durationSpanRef.current) {
        durationSpanRef.current.textContent = formatTime(dur);
      }
      if (inputRef.current) {
        const max = dur || 100;
        inputRef.current.max = max.toString();
        inputRef.current.value = pos.toString();
        const pct = max > 0 ? (pos / max) * 100 : 0;
        inputRef.current.style.setProperty('--progress', `${pct}%`);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const handlePointerUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      ipc.seek(draggingValueRef.current);
      usePlayerStore.setState({ positionMs: draggingValueRef.current });
    };

    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const handlePointerDown = () => {
    isDraggingRef.current = true;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    draggingValueRef.current = val;
    if (timeSpanRef.current) {
      timeSpanRef.current.textContent = formatTime(val);
    }
    const max = parseInt(e.target.max) || 100;
    const pct = max > 0 ? (val / max) * 100 : 0;
    e.target.style.setProperty('--progress', `${pct}%`);
  };

  const initialState = usePlayerStore.getState();
  const initialPos = initialState.positionMs;
  const initialDur = initialState.durationMs || 100;
  const initialPct = initialDur > 0 ? (initialPos / initialDur) * 100 : 0;

  return (
    <div className="flex items-center gap-2 w-full text-xs text-text-secondary">
      <span ref={timeSpanRef} className="font-mono tabular-nums">
        {formatTime(initialPos)}
      </span>
      <input
        ref={inputRef}
        type="range"
        min={0}
        max={initialDur}
        defaultValue={initialPos}
        style={{ '--progress': `${initialPct}%` } as React.CSSProperties}
        onPointerDown={handlePointerDown}
        onChange={handleChange}
        className="flex-1"
        aria-label="播放进度"
      />
      <span ref={durationSpanRef} className="font-mono tabular-nums">
        {formatTime(initialState.durationMs)}
      </span>
    </div>
  );
}
