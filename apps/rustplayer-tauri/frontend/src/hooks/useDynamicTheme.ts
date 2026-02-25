import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { ipc } from '@/lib/ipc';

const DEFAULT_H = 262, DEFAULT_S = 83, DEFAULT_L = 76; // #A78BFA

// LRU color cache (max 100 entries)
const colorCache = new Map<string, [number, number, number]>();
const CACHE_MAX = 100;

function hslToString(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = h / 360, sn = s / 100, ln = l / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return [v, v, v];
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(hn + 1 / 3) * 255),
    Math.round(hue2rgb(hn) * 255),
    Math.round(hue2rgb(hn - 1 / 3) * 255),
  ];
}

function applyTheme(h: number, s: number, l: number) {
  const root = document.documentElement;
  const [r, g, b] = hslToRgb(h, s, l);

  root.style.setProperty('--accent', hslToString(h, s, l));
  root.style.setProperty('--accent-hover', hslToString(h, s, Math.min(l + 10, 90)));
  root.style.setProperty('--accent-active', hslToString(h, s, Math.max(l - 10, 20)));
  root.style.setProperty('--accent-subtle', `rgba(${r}, ${g}, ${b}, 0.15)`);
  root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.25)`);
  root.style.setProperty('--shadow-glow',
    `0 0 20px rgba(${r}, ${g}, ${b}, 0.3), 0 0 40px rgba(${r}, ${g}, ${b}, 0.15)`);
  root.style.setProperty('--shadow-glow-strong',
    `0 0 30px rgba(${r}, ${g}, ${b}, 0.4), 0 0 60px rgba(${r}, ${g}, ${b}, 0.2)`);
}

export function useDynamicTheme() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  useEffect(() => {
    if (!currentTrack?.coverUrl) {
      applyTheme(DEFAULT_H, DEFAULT_S, DEFAULT_L);
      return;
    }

    const url = currentTrack.coverUrl;

    // Cache hit
    const cached = colorCache.get(url);
    if (cached) {
      applyTheme(cached[0], cached[1], cached[2]);
      return;
    }

    // Backend extraction (no CORS issues)
    ipc.extractCoverColor(url).then(([h, s, l]) => {
      // Race condition guard
      if (usePlayerStore.getState().currentTrack?.coverUrl !== url) return;

      // LRU eviction
      if (colorCache.size >= CACHE_MAX) {
        colorCache.delete(colorCache.keys().next().value!);
      }
      colorCache.set(url, [h, s, l]);
      applyTheme(h, s, l);
    }).catch((err) => {
      console.warn('[useDynamicTheme] color extraction failed:', err);
      applyTheme(DEFAULT_H, DEFAULT_S, DEFAULT_L);
    });
  }, [currentTrack?.coverUrl]);
}
