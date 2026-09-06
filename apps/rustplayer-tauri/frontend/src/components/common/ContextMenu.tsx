import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Track, usePlayerStore } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { Play, ListEnd, ListPlus, Copy } from 'lucide-react';

interface Props {
  x: number;
  y: number;
  track: Track;
  onClose: () => void;
}

const menuItems = [
  { label: '播放这首', icon: Play, action: 'play' },
  { label: '下一首播放', icon: ListEnd, action: 'insert-next' },
  { label: '加入队列', icon: ListPlus, action: 'add-queue' },
  { label: '复制歌曲名', icon: Copy, action: 'copy' },
] as const;

export default function ContextMenu({ x, y, track, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const menu = ref.current;
    const handle = (e: MouseEvent) => {
      if (menu && !menu.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener('mousedown', handle);
    // Focus first menu item on mount
    const firstItem = ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstItem?.focus();
    return () => {
      document.removeEventListener('mousedown', handle);
      if (previous?.isConnected && (menu?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
    };
  }, []);

  // Viewport boundary check
  const style: React.CSSProperties = { position: 'fixed', zIndex: 9999 };
  const menuW = 192, menuH = 184;
  style.left = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
  style.top = Math.max(8, Math.min(y, window.innerHeight - menuH - 8));

  const handleAction = (action: string) => {
    const store = usePlayerStore.getState();
    const toast = useToastStore.getState().addToast;
    switch (action) {
      case 'play': {
        void store.playTrack(track);
        break;
      }
      case 'insert-next':
        if (store.insertNext(track)) toast('success', `「${track.name}」将在下一首播放`);
        else toast('info', `「${track.name}」已是当前歌曲`);
        break;
      case 'add-queue': {
        const exists = store.queue.some(item => item.id === track.id && item.source === track.source);
        store.addToQueue([track]);
        toast(exists ? 'info' : 'success', exists ? `「${track.name}」已在队列中` : `已加入「${track.name}」到队列`);
        break;
      }
      case 'copy':
        navigator.clipboard.writeText(`${track.name} - ${track.artist}`).then(
          () => toast('info', '已复制到剪贴板'),
          () => toast('error', '复制失败'),
        );
        break;
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll('[role="menuitem"]') || []) as HTMLButtonElement[];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const current = index === -1 ? 0 : index;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    <div ref={ref} role="menu" aria-label={`${track.name}的歌曲操作`} style={style} tabIndex={-1} onKeyDown={handleKeyDown}
      className="w-48 bg-bg-elevated rounded-xl shadow-xl border border-border-primary py-1 animate-scale-in origin-top-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {menuItems.map((item) => (
        <button
          key={item.action}
          role="menuitem"
          onClick={() => handleAction(item.action)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-150 cursor-pointer focus-visible:bg-bg-hover focus-visible:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
        >
          <item.icon size={16} strokeWidth={1.5} />
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
