import { useRef, useState, useEffect, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface HorizontalScrollProps {
  children: ReactNode;
  className?: string;
}

export default function HorizontalScroll({ children, className = '' }: HorizontalScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = ref.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    checkScroll();
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro.disconnect();
    };
  }, []);

  const scroll = (dir: -1 | 1) => {
    ref.current?.scrollBy({ left: dir * 300, behavior: 'smooth' });
  };

  return (
    <div className={`relative group ${className}`}>
      {canScrollLeft && (
        <button
          onClick={() => scroll(-1)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full
            bg-bg-elevated/90 shadow-md flex items-center justify-center
            opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          aria-label="向左滚动"
        >
          <ChevronLeft size={16} />
        </button>
      )}
      <div
        ref={ref}
        className="flex gap-4 overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: 'none' }}
      >
        {children}
      </div>
      {canScrollRight && (
        <button
          onClick={() => scroll(1)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full
            bg-bg-elevated/90 shadow-md flex items-center justify-center
            opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          aria-label="向右滚动"
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
