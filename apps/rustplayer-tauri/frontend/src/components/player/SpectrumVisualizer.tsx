import { useEffect, useRef } from 'react';
import { useVisualizerStore } from '@/store/visualizerStore';

export default function SpectrumVisualizer({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

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

    const renderLoop = () => {
      const { magnitudes, enabled } = useVisualizerStore.getState();

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

        magnitudes.forEach((val, i) => {
          // 频域数据通常是 0~255
          const normalizedVal = val > 1 ? val / 255 : val;
          const barHeight = normalizedVal * height;
          const x = i * barWidth;
          const y = height - barHeight;

          ctx.beginPath();
          // 圆角柱状图
          ctx.roundRect(x + 1, y, Math.max(1, barWidth - 2), barHeight, [2, 2, 0, 0]);
          ctx.fill();
        });
      }

      animationRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full h-full"
      style={{ filter: 'drop-shadow(0 0 8px var(--accent))' }}
    />
  );
}
