import type { ReactNode } from 'react';
import ImmersiveCover from './ImmersiveCover';
import ImmersiveTrackInfo from './ImmersiveTrackInfo';
import ImmersiveLyrics from './ImmersiveLyrics';

export default function ImmersiveContent({ children, preview = false }: { children?: ReactNode; preview?: boolean }) {
  return (
    <div className="immersive-composition relative z-10 flex flex-1 min-h-0 h-full">
      <div className="w-1/2 min-w-0 flex flex-col items-center justify-center p-6 lg:p-12">
        <ImmersiveCover />
        <ImmersiveTrackInfo />
        {children}
      </div>
      <section className="w-1/2 min-w-0 flex flex-col" aria-label="歌词">
        <ImmersiveLyrics emptyContent={preview ? (
          <div className="space-y-6" aria-label="歌词排版示例">
            <p className="text-xs text-white/60">歌词排版示例 · 播放歌曲后显示实际歌词</p>
            <p className="text-2xl text-white/30">晚风轻轻经过</p>
            <p className="text-3xl font-bold text-white">让这一刻，留在旋律里</p>
            <p className="text-2xl text-white/30">听见光落下的声音</p>
          </div>
        ) : undefined} />
      </section>
    </div>
  );
}
