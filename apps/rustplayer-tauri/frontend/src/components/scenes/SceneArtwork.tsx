import type { SceneEffect } from '@/lib/scenes/model';

/** Static gallery artwork: browsing a collection never starts one renderer per card. */
export default function SceneArtwork({ effect }: { effect: SceneEffect }) {
  return <svg viewBox="0 0 180 140" fill="none" aria-hidden="true" className="scene-artwork">
    {Array.from({ length: effect === 'meteor' ? 5 : 24 }, (_, i) => {
      const fraction = (seed: number) => { const value = Math.sin(seed * 127.1) * 43758.5453; return value - Math.floor(value); };
      const x = fraction(i + 1) * 180, y = fraction(i + 81) * 140, r = .8 + (i % 3) * .8;
      if (effect === 'rain') return <path key={i} d={`M${x} ${y}l-5 21`} stroke="currentColor" opacity={.25 + i % 3 * .2} />;
      if (effect === 'meteor') return <path key={i} d={`M${x} ${y}l-35 31`} stroke="currentColor" strokeWidth={1.4} opacity={.4 + i % 2 * .4} />;
      if (effect === 'bubble') return <circle key={i} cx={x} cy={y} r={r * 3} stroke="currentColor" opacity=".45" />;
      if (effect === 'petal') return <ellipse key={i} cx={x} cy={y} rx={r * 2.8} ry={r} transform={`rotate(${i * 37} ${x} ${y})`} fill="currentColor" opacity=".6" />;
      if (effect === 'pulse') {
        const angle = i / 24 * Math.PI * 2, distance = 20 + (i % 3) * 19;
        return <path key={i} d={`M${90 + Math.cos(angle) * distance} ${70 + Math.sin(angle) * distance}l${Math.cos(angle) * 14} ${Math.sin(angle) * 14}`} stroke="currentColor" strokeWidth={r} opacity=".7" />;
      }
      return <g key={i}><circle cx={x} cy={y} r={r} fill="currentColor" opacity={.35 + i % 3 * .25} />{effect === 'firefly' && <circle cx={x} cy={y} r={r * 3} fill="currentColor" opacity=".12" />}</g>;
    })}
  </svg>;
}
