import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

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

async function extractDominantColor(imgUrl: string): Promise<[number, number, number] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imgUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);

      canvas.width = 20;
      canvas.height = 20;
      ctx.drawImage(img, 0, 0, 20, 20);

      try {
        const data = ctx.getImageData(0, 0, 20, 20).data;

        // 12 hue buckets of 30° each: [sumH, sumS, sumL, count]
        const buckets: [number, number, number, number][] = Array.from({ length: 12 }, () => [0, 0, 0, 0]);

        for (let i = 0; i < data.length; i += 4) {
          const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          // Filter low-saturation and extreme-lightness pixels
          if (s < 20 || l < 15 || l > 90) continue;
          const bucket = Math.floor(h / 30) % 12;
          buckets[bucket][0] += h;
          buckets[bucket][1] += s;
          buckets[bucket][2] += l;
          buckets[bucket][3]++;
        }

        // Find the most populated bucket
        let best = -1, bestCount = 0;
        for (let i = 0; i < 12; i++) {
          if (buckets[i][3] > bestCount) {
            bestCount = buckets[i][3];
            best = i;
          }
        }

        if (best === -1 || bestCount === 0) return resolve(null);

        const [sumH, sumS, sumL, count] = buckets[best];
        let h = sumH / count;
        let s = sumS / count;
        let l = sumL / count;

        // Enforce vivid output: saturation >= 50%, lightness 45%–65%
        s = Math.max(s, 50);
        l = Math.min(Math.max(l, 45), 65);

        resolve([h, s, l]);
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
  });
}

const DEFAULT_H = 262, DEFAULT_S = 83, DEFAULT_L = 76; // #A78BFA

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

    const capturedUrl = currentTrack.coverUrl;

    extractDominantColor(capturedUrl).then((hsl) => {
      // Race condition guard: ignore if track changed while extracting
      const latestUrl = usePlayerStore.getState().currentTrack?.coverUrl;
      if (latestUrl !== capturedUrl) return;

      if (hsl) {
        applyTheme(hsl[0], hsl[1], hsl[2]);
      } else {
        applyTheme(DEFAULT_H, DEFAULT_S, DEFAULT_L);
      }
    });
  }, [currentTrack?.coverUrl]);
}
