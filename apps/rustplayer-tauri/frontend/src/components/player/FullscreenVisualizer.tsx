import { useEffect, useRef, useState } from 'react';
import { useVisualizerStore, spectrumDataRef } from '@/store/visualizerStore';

const getPrefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function FullscreenVisualizer({ width, height }: { width: number; height: number }) {
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
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    if (prefersReducedMotion) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    let cachedAccent = '#8B5CF6';
    let frameCount = 0;

    const renderLoop = () => {
      const { enabled, visualizationMode } = useVisualizerStore.getState();
      const magnitudes = spectrumDataRef.current;

      ctx.clearRect(0, 0, width, height);

      if (!enabled) {
        animationRef.current = requestAnimationFrame(renderLoop);
        return;
      }

      // Refresh accent color every ~0.5s, normalized to #rrggbb hex
      // so that appending alpha suffix (e.g. '40') produces valid 8-digit hex.
      if (frameCount++ % 30 === 0) {
        const raw =
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
        ctx.fillStyle = raw;
        cachedAccent = ctx.fillStyle; // Canvas getter always returns #rrggbb
      }

      // Empty data gate
      if (magnitudes && magnitudes.length > 0 && magnitudes.some((v) => v > 0)) {
        switch (visualizationMode) {
          case 'bars':
            drawBars(ctx, magnitudes, width, height, cachedAccent);
            break;
          case 'circle':
            drawCircle(ctx, magnitudes, width, height, cachedAccent);
            break;
          case 'wave':
            drawWave(ctx, magnitudes, width, height, cachedAccent);
            break;
        }
      }

      animationRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [width, height, prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="w-full h-full"
      aria-hidden="true"
    />
  );
}

// --- Bars mode ---
function drawBars(
  ctx: CanvasRenderingContext2D,
  magnitudes: Float32Array,
  width: number,
  height: number,
  accent: string,
) {
  const barCount = magnitudes.length;
  const barWidth = width / barCount;

  // Gradient from bottom (opaque) to top (semi-transparent)
  const gradient = ctx.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, accent);
  gradient.addColorStop(1, accent + '40');

  ctx.fillStyle = gradient;
  ctx.beginPath();

  for (let i = 0; i < barCount; i++) {
    const val = magnitudes[i] > 1 ? magnitudes[i] / 255 : magnitudes[i];
    const barHeight = val * height * 0.7;
    const x = i * barWidth;
    const y = height - barHeight;
    ctx.roundRect(x + 1, y, Math.max(1, barWidth - 2), barHeight, [3, 3, 0, 0]);
  }
  ctx.fill();
}

// --- Circle mode ---
function drawCircle(
  ctx: CanvasRenderingContext2D,
  magnitudes: Float32Array,
  width: number,
  height: number,
  accent: string,
) {
  const cx = width / 2;
  const cy = height / 2;
  const baseRadius = Math.min(width, height) * 0.2;
  const maxBarLen = Math.min(width, height) * 0.15;
  const count = magnitudes.length;

  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const val = magnitudes[i] > 1 ? magnitudes[i] / 255 : magnitudes[i];
    const barLen = val * maxBarLen;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x1 = cx + cos * baseRadius;
    const y1 = cy + sin * baseRadius;
    const x2 = cx + cos * (baseRadius + barLen);
    const y2 = cy + sin * (baseRadius + barLen);

    ctx.globalAlpha = 0.5 + val * 0.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// --- Wave mode ---
function drawWave(
  ctx: CanvasRenderingContext2D,
  magnitudes: Float32Array,
  width: number,
  height: number,
  accent: string,
) {
  const midY = height * 0.7;
  const count = magnitudes.length;
  if (count < 2) return;
  const step = width / (count - 1);

  // Collect y values
  const yValues: number[] = [];
  for (let i = 0; i < count; i++) {
    const val = magnitudes[i] > 1 ? magnitudes[i] / 255 : magnitudes[i];
    yValues.push(midY - val * height * 0.3);
  }

  // Draw wave with quadratic bezier curves
  ctx.beginPath();
  ctx.moveTo(0, yValues[0]);
  for (let i = 1; i < count; i++) {
    const x = i * step;
    const prevX = (i - 1) * step;
    const cpx = (prevX + x) / 2;
    ctx.quadraticCurveTo(cpx, yValues[i - 1], x, yValues[i]);
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Fill gradient below wave
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, midY - height * 0.3, 0, height);
  gradient.addColorStop(0, accent + '40');
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fill();
}
