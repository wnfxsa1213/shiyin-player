import { useRef, useEffect } from 'react';
import { useVisualizerStore } from '@/store/visualizerStore';

interface Props {
  width: number;
  height: number;
  className?: string;
}

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

const MAX_PARTICLES = 120;

export default function ParticleSystem({ width, height, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      const { enabled, showParticles, colors, magnitudes } = useVisualizerStore.getState();
      ctx.clearRect(0, 0, width, height);

      if (!enabled || !showParticles) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Low frequency energy (first 8 bands)
      const lowEnergy = magnitudes.slice(0, 8).reduce((a, b) => a + b, 0) / 8;

      // Spawn particles based on low frequency energy
      const spawnRate = Math.floor(lowEnergy * 4);
      for (let i = 0; i < spawnRate && particles.current.length < MAX_PARTICLES; i++) {
        particles.current.push({
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

      // Update and draw particles
      const alive: Particle[] = [];
      for (const p of particles.current) {
        p.life++;
        if (p.life >= p.maxLife) continue;

        p.x += p.vx;
        p.y += p.vy;
        p.vy *= 0.98;
        p.vx *= 0.99;
        p.alpha = (1 - p.life / p.maxLife) * 0.7;
        p.size *= 0.995;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();

        alive.push(p);
      }
      ctx.globalAlpha = 1;
      particles.current = alive;

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className={className}
      aria-hidden="true"
    />
  );
}
