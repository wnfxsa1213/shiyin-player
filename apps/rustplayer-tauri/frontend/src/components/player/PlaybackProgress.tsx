import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useSceneEnvironment } from '@/store/sceneEnvironmentStore';
import { formatTime } from '@/lib/utils';

export default function PlaybackProgress({ active = true }: { active?: boolean }) {
  const visible = useSceneEnvironment(state => state.visible);
  const reducedMotion = useSceneEnvironment(state => state.reducedMotion);
  const timeSpanRef = useRef<HTMLSpanElement>(null);
  const durationSpanRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingValueRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const draggingPlaybackIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !visible) return;
    let rafId: number | undefined;
    let anchor = performance.now();
    let player = usePlayerStore.getState();
    let lastSecond = -1, lastDuration = -1;
    const paint = (position: number) => {
      const duration = player.durationMs;
      if (lastDuration !== duration) {
        lastDuration = duration;
        if (durationSpanRef.current) durationSpanRef.current.textContent = formatTime(duration);
        if (inputRef.current) inputRef.current.max = String(duration || 100);
      }
      if (isDraggingRef.current) return;
      const clamped = Math.max(0, duration > 0 ? Math.min(position, duration) : position);
      const second = Math.floor(clamped / 1000);
      if (second !== lastSecond && timeSpanRef.current) {
        lastSecond = second; timeSpanRef.current.textContent = formatTime(clamped);
      }
      if (inputRef.current) {
        inputRef.current.value = String(clamped);
        inputRef.current.style.setProperty('--progress', `${clamped / (duration || 100) * 100}%`);
      }
    };
    const tick = () => {
      rafId = undefined;
      paint(player.positionMs + (player.state === 'playing' ? performance.now() - anchor : 0));
      if (player.state === 'playing' && !reducedMotion) rafId = requestAnimationFrame(tick);
    };
    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (state.state === previous.state && state.positionMs === previous.positionMs
        && state.durationMs === previous.durationMs && state.emittedAtMs === previous.emittedAtMs) return;
      player = state;
      const latency = state.emittedAtMs && state.emittedAtMs !== previous.emittedAtMs
        ? Math.min(1000, Math.max(0, Date.now() - state.emittedAtMs)) : 0;
      anchor = performance.now() - latency;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      rafId = undefined;
      tick();
    });
    tick();
    return () => { if (rafId !== undefined) cancelAnimationFrame(rafId); unsubscribe(); };
  }, [active, visible, reducedMotion]);

  useEffect(() => {
    const handlePointerUp = () => {
      if (!isDraggingRef.current) return;
      const player = usePlayerStore.getState();
      if (player.playbackId !== draggingPlaybackIdRef.current) cancelDrag();
      else isDraggingRef.current = false;
      void player.seek(draggingValueRef.current, draggingPlaybackIdRef.current);
    };

    window.addEventListener('pointerup', handlePointerUp);
    const cancelDrag = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const { positionMs, durationMs } = usePlayerStore.getState();
      if (inputRef.current) {
        inputRef.current.value = String(positionMs);
        inputRef.current.style.setProperty('--progress', `${positionMs / (durationMs || 100) * 100}%`);
      }
      if (timeSpanRef.current) timeSpanRef.current.textContent = formatTime(positionMs);
    };
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('blur', cancelDrag);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', cancelDrag);
      window.removeEventListener('blur', cancelDrag);
    };
  }, []);

  const handlePointerDown = () => {
    draggingPlaybackIdRef.current = usePlayerStore.getState().playbackId;
    draggingValueRef.current = Number(inputRef.current?.value ?? usePlayerStore.getState().positionMs);
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
    if (!isDraggingRef.current) void usePlayerStore.getState().seek(val);
  };

  const initialState = usePlayerStore.getState();
  const initialPos = initialState.positionMs;
  const initialDur = initialState.durationMs || 100;
  const initialPct = initialDur > 0 ? (initialPos / initialDur) * 100 : 0;

  return (
    <div className="flex w-full items-center gap-2 text-xs leading-none text-text-secondary">
      <span ref={timeSpanRef} className="w-11 flex-shrink-0 text-center font-mono tabular-nums">
        {formatTime(initialPos)}
      </span>
      <input
        ref={inputRef}
        type="range"
        name="progress"
        min={0}
        max={initialDur}
        defaultValue={initialPos}
        style={{ '--progress': `${initialPct}%` } as React.CSSProperties}
        onPointerDown={handlePointerDown}
        onChange={handleChange}
        className="min-w-0 flex-1"
        aria-label="播放进度"
      />
      <span ref={durationSpanRef} className="w-11 flex-shrink-0 text-center font-mono tabular-nums">
        {formatTime(initialState.durationMs)}
      </span>
    </div>
  );
}
