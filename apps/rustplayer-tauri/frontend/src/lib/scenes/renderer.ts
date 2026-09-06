import type { SceneEffect, VisualScene } from './model';

export type QualityTier = 0 | 1 | 2;
const QUALITY = [
  { count: 40, scale: .5, fps: 20 },
  { count: 80, scale: .75, fps: 30 },
  { count: 128, scale: 1, fps: 30 },
] as const;

/** Two bad 2s windows to reduce quality; 16 uninterrupted good seconds to recover. */
export function createQualityGovernor() {
  let tier: QualityTier = 1;
  let elapsed = 0, frames = 0, slow = 0, badWindows = 0, goodWindows = 0;
  return {
    get tier() { return tier; },
    resetWindow() { elapsed = frames = slow = badWindows = goodWindows = 0; },
    observe(gap: number, drawCost: number): boolean {
      elapsed += gap; frames++;
      // A missed frame on the 60Hz baseline (~33ms) is already pressure on the UI.
      if (gap > 26 || drawCost > 5) slow++;
      if (elapsed < 2000) return false;
      const bad = slow / frames > .12;
      badWindows = bad ? badWindows + 1 : 0;
      goodWindows = bad ? 0 : goodWindows + 1;
      elapsed = frames = slow = 0;
      if (badWindows >= 2 && tier > 0) { tier = (tier - 1) as QualityTier; badWindows = goodWindows = 0; return true; }
      if (goodWindows >= 8 && tier < 2) { tier = (tier + 1) as QualityTier; badWindows = goodWindows = 0; return true; }
      return false;
    },
  };
}

/** GStreamer magnitudes are normalized 0..1. No audio data means no synthetic beat. */
export function spectrumEnergy(magnitudes: Float32Array): number {
  let all = 0, low = 0;
  for (let index = 0; index < magnitudes.length; index++) {
    const value = Number.isFinite(magnitudes[index]) ? Math.max(0, Math.min(1, magnitudes[index])) : 0;
    all += value;
    if (index < 8) low += value;
  }
  return Math.min(1, (all / Math.max(1, magnitudes.length) * .45 + low / 8 * .55) * 1.7);
}

interface Particle { x: number; y: number; size: number; speed: number; phase: number; }
interface Frame {
  ctx: CanvasRenderingContext2D; width: number; height: number; time: number; dt: number;
  energy: number; particles: Particle[]; count: number; glow: HTMLCanvasElement;
}
type EffectPainter = (frame: Frame) => void;
const TAU = Math.PI * 2;
const wrap = (value: number) => (value % 1 + 1) % 1;

// Effect painters share allocation, scheduling, audio smoothing and quality management.
const painters: Record<SceneEffect, EffectPainter> = {
  star: ({ ctx, width, height, time, dt, energy, particles, count, glow }) => {
    for (let i = 0; i < count; i++) {
      const p = particles[i]; p.y = wrap(p.y - dt * .004 * p.speed * (1 + energy * 2));
      const r = p.size * (1 + energy * 2);
      ctx.globalAlpha = .25 + (.5 + .5 * Math.sin(time * p.speed + p.phase)) * .65;
      ctx.drawImage(glow, p.x * width - r * 3, p.y * height - r * 3, r * 6, r * 6);
    }
  },
  rain: ({ ctx, width, height, dt, energy, particles, count }) => {
    ctx.globalAlpha = .35 + energy * .45; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const p = particles[i]; p.y = wrap(p.y + dt * .35 * p.speed * (1 + energy));
      const x = p.x * width, y = p.y * (height + 40) - 20, tail = 12 + p.size * 8 + energy * 22;
      ctx.moveTo(x, y); ctx.lineTo(x - tail * .22, y + tail);
    }
    ctx.stroke();
  },
  snow: ({ ctx, width, height, time, dt, energy, particles, count }) => {
    ctx.globalAlpha = .65; ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const p = particles[i]; p.y = wrap(p.y + dt * .025 * p.speed * (1 + energy));
      const x = p.x * width + Math.sin(time * .4 + p.phase) * (18 + energy * 20), y = p.y * (height + 12) - 6;
      ctx.moveTo(x + p.size, y); ctx.arc(x, y, p.size * (1 + energy * .3), 0, TAU);
    }
    ctx.fill();
  },
  firefly: ({ ctx, width, height, time, dt, energy, particles, count, glow }) => {
    for (let i = 0; i < count * .65; i++) {
      const p = particles[i]; p.y = wrap(p.y - dt * .012 * p.speed);
      const x = p.x * width + Math.sin(time * .6 + p.phase) * 32, y = p.y * height + Math.cos(time * .5 + p.phase) * 18;
      const radius = p.size * (5 + energy * 8);
      ctx.globalAlpha = (.35 + .65 * Math.sin(time * p.speed + p.phase) ** 2) * (.45 + energy * .55);
      ctx.drawImage(glow, x - radius, y - radius, radius * 2, radius * 2);
    }
  },
  meteor: ({ ctx, width, height, dt, energy, particles, count }) => {
    ctx.lineCap = 'round';
    for (let i = 0; i < Math.max(3, count * .1); i++) {
      const p = particles[i]; p.y = wrap(p.y + dt * .17 * p.speed * (1 + energy * 1.5));
      const x = (p.x * 1.6 - p.y * .6) * width, y = p.y * (height + 100) - 50;
      const tail = (30 + p.size * 20) * (1 + energy);
      for (let segment = 0; segment < 4; segment++) {
        ctx.globalAlpha = (.65 + energy * .3) * (1 - segment / 4);
        ctx.lineWidth = Math.max(.5, 2 - segment * .4);
        ctx.beginPath(); ctx.moveTo(x + tail * segment / 4, y - tail * segment / 4);
        ctx.lineTo(x + tail * (segment + 1) / 4, y - tail * (segment + 1) / 4); ctx.stroke();
      }
    }
  },
  bubble: ({ ctx, width, height, time, dt, energy, particles, count }) => {
    ctx.lineWidth = 1; ctx.globalAlpha = .35 + energy * .4; ctx.beginPath();
    for (let i = 0; i < count * .45; i++) {
      const p = particles[i]; p.y = wrap(p.y - dt * .024 * p.speed * (1 + energy * 2));
      const radius = p.size * (4 + energy * 5);
      const x = p.x * width + Math.sin(time * .5 + p.phase) * 12, y = p.y * (height + 50) - 25;
      ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, TAU);
    }
    ctx.stroke();
  },
  petal: ({ ctx, width, height, time, dt, energy, particles, count }) => {
    ctx.globalAlpha = .55 + energy * .3; ctx.beginPath();
    for (let i = 0; i < count * .6; i++) {
      const p = particles[i]; p.y = wrap(p.y + dt * .04 * p.speed * (1 + energy));
      const x = wrap(p.x + p.y * .22) * width + Math.sin(time + p.phase) * 16, y = p.y * (height + 24) - 12;
      const angle = time * p.speed + p.phase;
      ctx.moveTo(x + Math.cos(angle) * p.size * 3, y + Math.sin(angle) * p.size * 3);
      ctx.ellipse(x, y, p.size * 3, Math.max(.6, p.size * Math.abs(Math.sin(angle))), angle, 0, TAU);
    }
    ctx.fill();
  },
  pulse: ({ ctx, width, height, dt, energy, particles, count }) => {
    ctx.globalAlpha = .4 + energy * .6; ctx.beginPath();
    const extent = Math.hypot(width, height) * .6;
    for (let i = 0; i < count; i++) {
      const p = particles[i]; p.y = wrap(p.y + dt * (.025 + energy * .28) * p.speed);
      const distance = p.y * extent, angle = p.phase;
      const x = width / 2 + Math.cos(angle) * distance, y = height / 2 + Math.sin(angle) * distance;
      const radius = p.size * (.5 + energy * 1.8);
      ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, TAU);
    }
    ctx.fill();
  },
};

export function createSceneRenderer(canvas: HTMLCanvasElement, scene: VisualScene, light: boolean, getEnergy: () => number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const governor = createQualityGovernor();
  const particles = Array.from({ length: QUALITY[2].count }, () => ({ x: Math.random(), y: Math.random(), size: .8 + Math.random() * 1.8, speed: .5 + Math.random(), phase: Math.random() * TAU }));
  const glow = document.createElement('canvas'); glow.width = glow.height = 48;
  const glowCtx = glow.getContext('2d')!;
  const gradient = glowCtx.createRadialGradient(24, 24, 0, 24, 24, 24);
  gradient.addColorStop(0, scene.colors.particle); gradient.addColorStop(.15, scene.colors.particle + 'dd'); gradient.addColorStop(1, scene.colors.particle + '00');
  glowCtx.fillStyle = gradient; glowCtx.fillRect(0, 0, 48, 48);
  let width = 1, height = 1, active = false, raf = 0, last = 0, lastDraw = 0, time = 0, energy = 0;
  function resize(w: number, h: number) {
    width = Math.max(1, w); height = Math.max(1, h);
    // Bound pixel area independently of window size / HiDPI. Main view is always lighter.
    const scale = Math.min(QUALITY[governor.tier].scale, light ? .65 : 1, Math.sqrt(1_600_000 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    ctx!.setTransform(scale, 0, 0, scale, 0, 0);
    canvas.dataset.quality = String(governor.tier);
    draw(0);
  }
  function draw(dt: number) {
    const target = scene.followMusic ? getEnergy() : 0;
    energy += (target - energy) * (1 - Math.exp(-dt / (target > energy ? .07 : .3)));
    time += dt;
    ctx!.clearRect(0, 0, width, height); ctx!.fillStyle = ctx!.strokeStyle = scene.colors.particle;
    painters[scene.effect]({ ctx: ctx!, width, height, time, dt, energy, particles, glow, count: Math.round(QUALITY[governor.tier].count * (light ? .4 : 1)) });
    ctx!.globalAlpha = 1;
  }
  function tick(now: number) {
    if (!active) return;
    raf = requestAnimationFrame(tick);
    const gap = last ? now - last : 16.7; last = now;
    const interval = 1000 / (light ? 20 : QUALITY[governor.tier].fps);
    let cost = 0;
    if (!lastDraw || now - lastDraw >= interval - 1) {
      const dt = lastDraw ? Math.min(.1, (now - lastDraw) / 1000) : 0;
      lastDraw = now - ((now - lastDraw) % interval);
      const start = performance.now(); draw(dt); cost = performance.now() - start;
    }
    if (governor.observe(gap, cost)) resize(width, height);
  }
  return {
    resize,
    setActive(value: boolean) {
      if (active === value) return;
      active = value; canvas.dataset.running = String(value);
      cancelAnimationFrame(raf); last = lastDraw = 0; governor.resetWindow();
      if (value) raf = requestAnimationFrame(tick);
      else { energy = 0; draw(0); }
    },
    dispose() { active = false; cancelAnimationFrame(raf); canvas.width = canvas.height = 1; glow.width = glow.height = 1; },
  };
}
