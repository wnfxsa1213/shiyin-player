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
    let rafId: number;
    // Local interpolation state — updated by store subscription, read by RAF loop.
    let lastServerPos = usePlayerStore.getState().positionMs;
    let lastServerTime = performance.now();
    let lastDur = usePlayerStore.getState().durationMs;
    let isPlaying = usePlayerStore.getState().state === 'playing';

    // Subscribe to store for authoritative position/duration updates (~5Hz from backend).
    const unsubscribe = usePlayerStore.subscribe((state) => {
      isPlaying = state.state === 'playing';
      lastServerPos = state.positionMs;
      lastServerTime = performance.now();
      lastDur = state.durationMs;

      if (durationSpanRef.current) {
        durationSpanRef.current.textContent = formatTime(lastDur);
      }
      if (inputRef.current) {
        inputRef.current.max = (lastDur || 100).toString();
      }
    });

    // RAF loop for smooth 60fps progress bar interpolation.
    // Between backend updates, we locally extrapolate position assuming 1x playback rate.
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (isDraggingRef.current) return;

      const now = performance.now();
      const elapsed = isPlaying ? now - lastServerTime : 0;
      const pos = Math.min(lastServerPos + elapsed, lastDur);

      if (timeSpanRef.current) {
        timeSpanRef.current.textContent = formatTime(pos);
      }
      if (inputRef.current) {
        const max = lastDur || 100;
        const pct = max > 0 ? (pos / max) * 100 : 0;
        inputRef.current.value = pos.toString();
        inputRef.current.style.setProperty('--progress', `${pct}%`);
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      unsubscribe();
    };
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
