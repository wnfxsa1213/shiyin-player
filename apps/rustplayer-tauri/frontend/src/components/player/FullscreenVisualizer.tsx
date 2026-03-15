import { useEffect, useRef, useState } from 'react';
import { useVisualizerStore, spectrumDataRef } from '@/store/visualizerStore';

const getPrefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  color: string;
}

const MAX_PARTICLES = 60;

export default function FullscreenVisualizer({ width, height, alpha = 1 }: { width: number; height: number; alpha?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
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

    // Render at 75% internal resolution — the background visualizer is
    // semi-transparent and blended, so the slight softness is invisible.
    // Cuts pixel fill workload by ~44% vs native resolution.
    const RENDER_SCALE = 0.75;
    canvas.width = Math.round(width * RENDER_SCALE);
    canvas.height = Math.round(height * RENDER_SCALE);
    ctx.scale(RENDER_SCALE, RENDER_SCALE);

    if (prefersReducedMotion) {
      ctx.clearRect(0, 0, width, height);
      particlesRef.current = [];
      return;
    }

    // Cache accent color — updated via CSS variable observer, never getComputedStyle in RAF
    let cachedAccent = '#8B5CF6';
    // Read initial value once
    const rawInitial =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
    ctx.fillStyle = rawInitial;
    cachedAccent = ctx.fillStyle;

    // Observe --accent changes via MutationObserver on style attribute
    const observer = new MutationObserver(() => {
      const raw =
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
      ctx.fillStyle = raw;
      cachedAccent = ctx.fillStyle;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

    // Cache gradients — recreated only when accent changes
    let cachedBarsGradient: CanvasGradient | null = null;
    let cachedWaveGradient: CanvasGradient | null = null;
    let lastGradientAccent = '';

    const ensureGradients = () => {
      if (lastGradientAccent === cachedAccent) return;
      lastGradientAccent = cachedAccent;
      cachedBarsGradient = ctx.createLinearGradient(0, height, 0, 0);
      cachedBarsGradient.addColorStop(0, cachedAccent);
      cachedBarsGradient.addColorStop(1, cachedAccent + '40');
      cachedWaveGradient = ctx.createLinearGradient(0, height * 0.7 - height * 0.3, 0, height);
      cachedWaveGradient.addColorStop(0, cachedAccent + '40');
      cachedWaveGradient.addColorStop(1, 'transparent');
    };

    // Throttle to ~30fps — spectrum data arrives at ~15fps and particle physics
    // don't need 60fps precision. Halves GPU workload on full-screen canvas.
    let lastFrameTime = 0;
    const FRAME_INTERVAL = 1000 / 30; // ~33ms

    const renderLoop = (now: number) => {
      animationRef.current = requestAnimationFrame(renderLoop);

      const delta = now - lastFrameTime;
      if (delta < FRAME_INTERVAL) return;
      lastFrameTime = now - (delta % FRAME_INTERVAL);

      const { enabled, visualizationMode, showParticles, colors } = useVisualizerStore.getState();
      const magnitudes = spectrumDataRef.current;

      ctx.clearRect(0, 0, width, height);

      if (!enabled) return;

      ensureGradients();

      // Apply background alpha via canvas globalAlpha instead of a DOM opacity
      // wrapper — avoids creating an extra GPU compositing layer on WebKitGTK.
      ctx.globalAlpha = alpha;

      // --- Draw visualizer ---
      let hasSignal = false;
      if (magnitudes && magnitudes.length > 0) {
        for (let i = 0; i < magnitudes.length; i++) {
          if (magnitudes[i] > 0) { hasSignal = true; break; }
        }
      }

      if (hasSignal) {
        switch (visualizationMode) {
          case 'bars':
            drawBars(ctx, magnitudes, width, height, cachedAccent, cachedBarsGradient!);
            break;
          case 'circle':
            drawCircle(ctx, magnitudes, width, height, cachedAccent, alpha);
            break;
          case 'wave':
            drawWave(ctx, magnitudes, width, height, cachedAccent, cachedWaveGradient!);
            break;
        }
      }

      // --- Draw particles (merged from ParticleSystem) ---
      if (showParticles) {
        let lowSum = 0;
        const bandCount = Math.min(8, magnitudes.length);
        for (let i = 0; i < bandCount; i++) lowSum += magnitudes[i];
        const lowEnergy = bandCount > 0 ? lowSum / bandCount : 0;

        const spawnRate = Math.floor(lowEnergy * 4);
        for (let s = 0; s < spawnRate && particlesRef.current.length < MAX_PARTICLES; s++) {
          particlesRef.current.push({
            x: Math.random() * width,
            y: height + 5,
            vx: (Math.random() - 0.5) * 1.5,
            vy: -(1 + Math.random() * 2 + lowEnergy * 2),
            size: 2 + Math.random() * 3 + lowEnergy * 3,
            alpha: 0.6 + Math.random() * 0.4,
            life: 0,
            maxLife: 60 + Math.random() * 60,
            color: colors.particle,
          });
        }

        const alive: Particle[] = [];
        ctx.fillStyle = colors.particle;
        for (const p of particlesRef.current) {
          p.life++;
          if (p.life >= p.maxLife) continue;
          p.x += p.vx;
          p.y += p.vy;
          p.vy *= 0.98;
          p.vx *= 0.99;
          p.alpha = (1 - p.life / p.maxLife) * 0.7;
          p.size *= 0.995;

          ctx.globalAlpha = p.alpha * alpha;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          alive.push(p);
        }
        ctx.globalAlpha = 1;
        particlesRef.current = alive;
      }
    };

    animationRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      observer.disconnect();
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
  _accent: string,
  gradient: CanvasGradient,
) {
  const barCount = magnitudes.length;
  const barWidth = width / barCount;

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

// --- Circle mode (batched strokes) ---
function drawCircle(
  ctx: CanvasRenderingContext2D,
  magnitudes: Float32Array,
  width: number,
  height: number,
  accent: string,
  alpha: number,
) {
  const cx = width / 2;
  const cy = height / 2;
  const baseRadius = Math.min(width, height) * 0.2;
  const maxBarLen = Math.min(width, height) * 0.15;
  const count = magnitudes.length;

  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.7 * alpha;

  // Batch all lines into a single path + single stroke
  ctx.beginPath();
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
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.globalAlpha = alpha;
}

// --- Wave mode ---
function drawWave(
  ctx: CanvasRenderingContext2D,
  magnitudes: Float32Array,
  width: number,
  height: number,
  accent: string,
  gradient: CanvasGradient,
) {
  const midY = height * 0.7;
  const count = magnitudes.length;
  if (count < 2) return;
  const step = width / (count - 1);

  const yValues: number[] = [];
  for (let i = 0; i < count; i++) {
    const val = magnitudes[i] > 1 ? magnitudes[i] / 255 : magnitudes[i];
    yValues.push(midY - val * height * 0.3);
  }

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

  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}
