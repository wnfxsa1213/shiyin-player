import { useEffect, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePlayerStore } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { sanitizeError } from '@/lib/errorMessages';
import { ipc } from '@/lib/ipc';

interface LyricsLine {
  time_ms: number;
  text: string;
  translation: string | null;
}

const LYRICS_TOP_PADDING = 200;
const LYRICS_BOTTOM_PADDING = 300;

export default function ImmersiveLyrics() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [lyrics, setLyrics] = useState<LyricsLine[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch lyrics with race condition protection
  useEffect(() => {
    if (!currentTrack) {
      setLyrics([]);
      return;
    }
    let active = true;
    ipc
      .getLyrics(currentTrack.id, currentTrack.source)
      .then((data) => {
        if (active) setLyrics(data);
      })
      .catch((err) => {
        if (active) {
          setLyrics([]);
          useToastStore.getState().addToast('error', `歌词加载失败: ${sanitizeError(err)}`);
        }
      });
    return () => {
      active = false;
    };
  }, [currentTrack?.id, currentTrack?.source]);

  // Binary search for active lyric line
  const activeIndex = usePlayerStore((s) => {
    if (lyrics.length === 0) return 0;
    let lo = 0,
      hi = lyrics.length - 1,
      result = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (lyrics[mid].time_ms <= s.positionMs) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  });

  const virtualizer = useVirtualizer({
    count: lyrics.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => (lyrics[index]?.translation ? 100 : 72),
    overscan: 6,
  });

  // Auto-scroll to active line — debounced to avoid overlapping smooth scrolls
  // when lyrics lines change rapidly (e.g. fast songs).
  useEffect(() => {
    if (!containerRef.current || lyrics.length === 0) return;
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      virtualizer.scrollToIndex(activeIndex, { align: 'center', behavior: 'smooth' });
    }, 300);
    return () => clearTimeout(scrollTimerRef.current);
  }, [activeIndex, lyrics.length, virtualizer]);

  if (lyrics.length === 0) {
    return (
      <div className="flex items-center justify-center h-full px-8">
        <p className="text-white/30 text-lg">暂无歌词</p>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      {/* Top fade mask */}
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-black/90 to-transparent z-10 pointer-events-none" />
      {/* Bottom fade mask */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/90 to-transparent z-10 pointer-events-none" />

      <div
        ref={containerRef}
        className="h-full overflow-y-auto px-8 scrollbar-hide"
        style={{
          paddingTop: LYRICS_TOP_PADDING,
          paddingBottom: LYRICS_BOTTOM_PADDING,
        }}
      >
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const line = lyrics[vItem.index];
            const isActive = vItem.index === activeIndex;
            const distance = Math.abs(vItem.index - activeIndex);
            const isNearby = !isActive && distance <= 3;

            return (
              <div
                key={vItem.key}
                ref={virtualizer.measureElement}
                data-index={vItem.index}
                className={vItem.index === lyrics.length - 1 ? '' : 'pb-6'}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vItem.start}px)`,
                }}
              >
                <div
                  className={`transition-[transform,opacity] duration-500 ${
                    isActive
                      ? ''
                      : isNearby
                        ? 'opacity-30'
                        : 'opacity-20'
                  }`}
                >
                  <p
                    className={
                      isActive
                        ? 'text-3xl font-bold text-white'
                        : 'text-2xl text-white/50'
                    }
                  >
                    {line.text || '...'}
                  </p>
                  {line.translation && (
                    <p
                      className={`text-base mt-1 ${
                        isActive ? 'text-white/70' : 'text-white/30'
                      }`}
                    >
                      {line.translation}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
