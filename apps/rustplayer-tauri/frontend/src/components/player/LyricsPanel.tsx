import { useEffect, useState, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { sanitizeError } from '@/lib/errorMessages';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { ipc } from '@/lib/ipc';
import ParticleSystem from '@/components/player/ParticleSystem';
import { X, Music } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface LyricsLine {
  time_ms: number;
  text: string;
  translation: string | null;
}

interface LyricsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const springTransition = { layout: { type: 'spring' as const, stiffness: 200, damping: 28 } };

export default function LyricsPanel({ isOpen, onClose }: LyricsPanelProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [lyrics, setLyrics] = useState<LyricsLine[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!containerRef.current || lyrics.length === 0) return;
    const el = containerRef.current.children[activeIndex] as HTMLElement;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label="歌词面板"
          aria-modal="true"
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 bg-bg-base z-[60] flex overflow-hidden border-l border-border-primary"
        >
          {/* Left Side: Shared Layout Album Cover */}
          <div className="w-1/2 flex items-center justify-center p-12">
            {currentTrack?.coverUrl && !coverFailed ? (
              <motion.img
                layout
                layoutId="cover-shared"
                src={currentTrack.coverUrl}
                alt=""
                width={384}
                height={384}
                className="w-96 h-96 rounded-2xl object-cover shadow-[var(--shadow-glow-strong)] transition-shadow duration-700"
                transition={springTransition}
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <motion.div
                layout
                layoutId="cover-shared"
                className="w-96 h-96 rounded-2xl bg-bg-secondary flex items-center justify-center shadow-xl"
                transition={springTransition}
              >
                <Music size={64} className="text-text-tertiary" aria-hidden="true" />
              </motion.div>
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

              <div
                ref={containerRef}
                className="relative z-[1] h-full overflow-y-auto space-y-8 py-64 px-12 pb-96"
              >
                {lyrics.length === 0 ? (
                  <p className="text-text-tertiary text-lg">暂无歌词</p>
                ) : (
                  lyrics.map((line, i) => (
                    <div
                      key={i}
                      className={`transition-[transform,opacity,filter] duration-500 origin-left ${
                        i === activeIndex ? 'scale-105'
                          : Math.abs(i - activeIndex) <= 3 ? 'opacity-30 blur-[1px]'
                          : 'opacity-30'
                      }`}
                    >
                      <p
                        className={`${
                          i === activeIndex
                            ? 'text-3xl lg:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-[var(--accent)]'
                            : 'text-2xl lg:text-3xl text-text-secondary'
                        }`}
                        style={{ transition: 'background-image 0.8s ease' }}
                      >
                        {line.text || '…'}
                      </p>
                      {line.translation && (
                        <p
                          className={`text-base mt-2 ${
                            i === activeIndex ? 'text-text-secondary' : 'text-text-tertiary'
                          }`}
                        >
                          {line.translation}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
