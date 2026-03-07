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

    // DPR 适配，提升高分屏清晰度
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // 缓存主题色，避免在 60FPS 循环中引发 DOM 样式重排 (Layout Thrashing)
    let cachedAccent = '#8B5CF6';
    let frameCount = 0;

    const drawStaticFallback = () => {
      cachedAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = cachedAccent;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(0, Math.max(0, height - 2), width, 2);
      ctx.globalAlpha = 1;
    };

    if (prefersReducedMotion) {
      drawStaticFallback();
      return;
    }

    const renderLoop = () => {
      const { enabled } = useVisualizerStore.getState();
      const magnitudes = spectrumDataRef.current;

      // Keep rAF alive but skip drawing when disabled (matches ParticleSystem pattern)
      if (!enabled) {
        ctx.clearRect(0, 0, width, height);
        animationRef.current = requestAnimationFrame(renderLoop);
        return;
      }

      ctx.clearRect(0, 0, width, height);

      // 每 30 帧（约 0.5 秒）更新一次颜色，大幅降低 DOM API 调用开销
      if (frameCount++ % 30 === 0) {
        cachedAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
      }

      // 空数据门控：全为 0 时跳过绘制，降低 GPU 开销
      if (magnitudes && magnitudes.length > 0 && magnitudes.some(v => v > 0)) {
        const barWidth = width / magnitudes.length;

        ctx.fillStyle = cachedAccent;
        ctx.beginPath();

        for (let i = 0; i < magnitudes.length; i++) {
          const val = magnitudes[i];
          // 频域数据通常是 0~255
          const normalizedVal = val > 1 ? val / 255 : val;
          const barHeight = normalizedVal * height;
          const x = i * barWidth;
          const y = height - barHeight;
          // 圆角柱状图
          ctx.roundRect(x + 1, y, Math.max(1, barWidth - 2), barHeight, [2, 2, 0, 0]);
        }
        ctx.fill();
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
      width={width}
      height={height}
      className="w-full h-full shadow-[0_0_8px_var(--accent)]"
      aria-hidden="true"
    />
  );
}
