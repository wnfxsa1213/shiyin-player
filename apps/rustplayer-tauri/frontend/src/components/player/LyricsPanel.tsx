import { useEffect, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePlayerStore } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { sanitizeError } from '@/lib/errorMessages';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { ipc } from '@/lib/ipc';
import ParticleSystem from '@/components/player/ParticleSystem';
import { X, Music } from 'lucide-react';

interface LyricsLine {
  time_ms: number;
  text: string;
  translation: string | null;
}

interface LyricsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const getScrollBehavior = (): ScrollBehavior => (
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
);

const LYRICS_TOP_PADDING = 256;
const LYRICS_BOTTOM_PADDING = 384;

export default function LyricsPanel({ isOpen, onClose }: LyricsPanelProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [lyrics, setLyrics] = useState<LyricsLine[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [coverFailed, setCoverFailed] = useState(false);

  useFocusTrap(panelRef, isOpen, onClose);

  // Reset cover error state when track changes
  useEffect(() => {
    setCoverFailed(false);
  }, [currentTrack?.id, currentTrack?.source]);

  // Fetch lyrics with race condition protection
  useEffect(() => {
    if (!isOpen || !currentTrack) { setLyrics([]); return; }
    let active = true;
    ipc.getLyrics(currentTrack.id, currentTrack.source)
      .then((data) => { if (active) setLyrics(data); })
      .catch((err) => {
        if (active) {
          setLyrics([]);
          useToastStore.getState().addToast('error', `歌词加载失败: ${sanitizeError(err)}`);
        }
      });
    return () => { active = false; };
  }, [isOpen, currentTrack?.id, currentTrack?.source]);

  // Binary search for active lyric — O(log N)
  const activeIndex = usePlayerStore((s) => {
    if (!isOpen || lyrics.length === 0) return 0;
    let lo = 0, hi = lyrics.length - 1, result = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (lyrics[mid].time_ms <= s.positionMs) { result = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return result;
  });

  const virtualizer = useVirtualizer({
    count: lyrics.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => (lyrics[index]?.translation ? 120 : 84),
    overscan: 6,
  });

  useEffect(() => {
    if (!containerRef.current || lyrics.length === 0) return;
    virtualizer.scrollToIndex(activeIndex, { align: 'center' });
    const rafId = window.requestAnimationFrame(() => {
      lineRefs.current.get(activeIndex)?.scrollIntoView({
        behavior: getScrollBehavior(),
        block: 'center',
      });
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [activeIndex, lyrics.length, virtualizer]);

  useEffect(() => {
    if (!isOpen) return;
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="歌词面板"
      aria-modal="true"
      tabIndex={-1}
      className="fixed inset-0 bg-bg-base z-[60] flex overflow-hidden border-l border-border-primary animate-fade-in overscroll-contain"
    >
      {/* Left Side: Album Cover */}
      <div className="w-1/2 flex items-center justify-center p-12">
        {currentTrack?.coverUrl && !coverFailed ? (
          <img
            src={currentTrack.coverUrl}
            alt=""
            width={384}
            height={384}
            className="w-96 h-96 rounded-2xl object-cover shadow-[var(--shadow-glow-strong)] transition-shadow duration-700 animate-scale-in"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div
            className="w-96 h-96 rounded-2xl bg-bg-secondary flex items-center justify-center shadow-xl animate-scale-in"
          >
            <Music size={64} className="text-text-tertiary" aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Right Side: Lyrics */}
      <div className="w-1/2 flex flex-col relative">
        <div className="flex items-center justify-end px-8 py-6 z-20 absolute right-0 top-0">
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-bg-secondary/50 backdrop-blur-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            aria-label="关闭歌词"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <div className="relative flex-1 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-bg-base/90 to-transparent z-10 pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-bg-base/90 to-transparent z-10 pointer-events-none" />

          <div className="absolute inset-0 pointer-events-none opacity-35 z-0" aria-hidden="true">
            <ParticleSystem width={size.w / 2} height={size.h} />
          </div>

          {lyrics.length === 0 ? (
            <div className="relative z-[1] h-full flex items-center px-12">
              <p className="text-text-tertiary text-lg">暂无歌词</p>
            </div>
          ) : (
            <div
              ref={containerRef}
              className="relative z-[1] h-full overflow-y-auto px-12"
              style={{
                paddingTop: LYRICS_TOP_PADDING,
                paddingBottom: LYRICS_BOTTOM_PADDING,
              }}
            >
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                {virtualizer.getVirtualItems().map((vItem) => {
                  const line = lyrics[vItem.index];
                  const isActive = vItem.index === activeIndex;
                  const isNearby = !isActive && Math.abs(vItem.index - activeIndex) <= 3;

                  return (
                    <div
                      key={vItem.key}
                      ref={(node) => {
                        if (node) {
                          lineRefs.current.set(vItem.index, node);
                          virtualizer.measureElement(node);
                        } else {
                          lineRefs.current.delete(vItem.index);
                        }
                      }}
                      data-index={vItem.index}
                      className={vItem.index === lyrics.length - 1 ? '' : 'pb-8'}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vItem.start}px)`,
                      }}
                    >
                      <div
                        className={`origin-left transition-[transform,opacity] duration-500 ${
                          isActive ? 'scale-105'
                            : isNearby ? 'opacity-30 blur-[1px]'
                            : 'opacity-30'
                        }`}
                      >
                        <p
                          className={`${
                            isActive
                              ? 'text-3xl lg:text-4xl font-bold text-accent'
                              : 'text-2xl lg:text-3xl text-text-secondary'
                          }`}
                        >
                          {line.text || '…'}
                        </p>
                        {line.translation && (
                          <p
                            className={`text-base mt-2 ${
                              isActive ? 'text-text-secondary' : 'text-text-tertiary'
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
          )}
        </div>
      </div>
    </div>
  );
}
