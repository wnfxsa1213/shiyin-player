import { useState, useRef, useCallback, useEffect } from 'react';

export function useAutoHide(delayMs = 3000, active = true) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const resetTimer = useCallback(() => {
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), delayMs);
  }, [delayMs]);

  // Start auto-hide timer on mount so controls hide even without initial mouse move
  useEffect(() => {
    if (!active) return;
    resetTimer();
    return () => clearTimeout(timerRef.current);
  }, [active, resetTimer]);

  return { visible, onMouseMove: resetTimer, onMouseDown: resetTimer };
}
