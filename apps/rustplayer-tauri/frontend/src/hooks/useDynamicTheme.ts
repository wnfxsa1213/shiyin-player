import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';

// 使用 Canvas 提取图片的主色调
async function extractAverageColor(imgUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imgUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);

      // 缩小到 10x10 计算平均色，性能极高
      canvas.width = 10;
      canvas.height = 10;
      ctx.drawImage(img, 0, 0, 10, 10);

      try {
        const data = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0;
        let validPixels = 0;

        for (let i = 0; i < data.length; i += 4) {
          // 过滤掉过于黑暗的像素，防止主题太沉闷
          if (data[i] + data[i + 1] + data[i + 2] > 50) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            validPixels++;
          }
        }

        if (validPixels === 0) return resolve(null);

        // 返回稍微提亮的平均色
        resolve(`rgb(${~~(r / validPixels)}, ${~~(g / validPixels)}, ${~~(b / validPixels)})`);
      } catch (e) {
        // 跨域受限或其他错误
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
  });
}

export function useDynamicTheme() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  useEffect(() => {
    const root = document.documentElement;
    // 开启平滑过渡
    root.style.transition = '--accent 0.8s ease, --shadow-glow 0.8s ease';

    if (!currentTrack?.coverUrl) {
      // 恢复默认主题色 Violet
      root.style.setProperty('--accent', '#8B5CF6');
      root.style.setProperty('--shadow-glow', '0 0 20px rgba(139, 92, 246, 0.2), 0 0 40px rgba(139, 92, 246, 0.1)');
      return;
    }

    extractAverageColor(currentTrack.coverUrl).then((color) => {
      if (color) {
        root.style.setProperty('--accent', color);
        // 基于提取出的颜色生成发光阴影
        const rgbaColor = color.replace('rgb', 'rgba').replace(')', ', 0.3)');
        const rgbaGlow = color.replace('rgb', 'rgba').replace(')', ', 0.15)');
        root.style.setProperty('--shadow-glow', `0 0 20px ${rgbaColor}, 0 0 40px ${rgbaGlow}`);
      }
    });
  }, [currentTrack?.coverUrl]);
}