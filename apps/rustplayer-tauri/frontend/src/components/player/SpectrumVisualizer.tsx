import { useEffect, useRef, useState } from 'react';
import { useVisualizerStore, spectrumDataRef } from '@/store/visualizerStore';

const getPrefersReducedMotion = () => (
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

export default function SpectrumVisualizer({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);

    setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Cache accent color via MutationObserver instead of polling getComputedStyle
    let cachedAccent = '#8B5CF6';
    const rawInitial = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
    ctx.fillStyle = rawInitial;
    cachedAccent = ctx.fillStyle;

    const observer = new MutationObserver(() => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
      ctx.fillStyle = raw;
      cachedAccent = ctx.fillStyle;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

    const drawStaticFallback = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = cachedAccent;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(0, Math.max(0, height - 2), width, 2);
      ctx.globalAlpha = 1;
    };

    if (prefersReducedMotion) {
      drawStaticFallback();
      return () => observer.disconnect();
    }

    const renderLoop = () => {
      const { enabled } = useVisualizerStore.getState();
      const magnitudes = spectrumDataRef.current;

      if (!enabled) {
        ctx.clearRect(0, 0, width, height);
        animationRef.current = requestAnimationFrame(renderLoop);
        return;
      }

      ctx.clearRect(0, 0, width, height);

      // Check for signal using early-exit loop instead of .some()
      let hasSignal = false;
      if (magnitudes && magnitudes.length > 0) {
        for (let i = 0; i < magnitudes.length; i++) {
          if (magnitudes[i] > 0) { hasSignal = true; break; }
        }
      }

      if (hasSignal) {
        const barWidth = width / magnitudes.length;

        ctx.fillStyle = cachedAccent;
        ctx.beginPath();

        for (let i = 0; i < magnitudes.length; i++) {
          const val = magnitudes[i] > 1 ? magnitudes[i] / 255 : magnitudes[i];
          const barHeight = val * height;
          const x = i * barWidth;
          const y = height - barHeight;
          ctx.roundRect(x + 1, y, Math.max(1, barWidth - 2), barHeight, [2, 2, 0, 0]);
        }
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      observer.disconnect();
    };
  }, [width, height, prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full h-full shadow-[0_0_8px_var(--accent)]"
      aria-hidden="true"
    />
  );
}
