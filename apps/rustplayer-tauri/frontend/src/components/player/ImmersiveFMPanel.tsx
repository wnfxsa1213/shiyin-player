import { useEffect, useState, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAutoHide } from '@/hooks/useAutoHide';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import ImmersiveBackground from '@/components/player/ImmersiveBackground';
import ImmersiveCover from '@/components/player/ImmersiveCover';
import ImmersiveTrackInfo from '@/components/player/ImmersiveTrackInfo';
import ImmersiveLyrics from '@/components/player/ImmersiveLyrics';
import ImmersiveControls from '@/components/player/ImmersiveControls';
import VizModeSwitcher from '@/components/player/VizModeSwitcher';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ImmersiveFMPanel({ isOpen, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const { visible: controlsVisible, onMouseMove, onMouseDown } = useAutoHide(3000);

  useFocusTrap(panelRef, isOpen, onClose);

  // Enter native fullscreen when immersive mode opens, exit when it closes
  useEffect(() => {
    const win = getCurrentWindow();
    if (isOpen) {
      win.setFullscreen(true).catch(console.error);
    } else {
      win.setFullscreen(false).catch(console.error);
    }
  }, [isOpen]);

  // Update size on resize — debounced to avoid rapid canvas teardown/rebuild during fullscreen transitions
  useEffect(() => {
    if (!isOpen) return;
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    let timer: ReturnType<typeof setTimeout>;
    const debouncedUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 100);
    };
    window.addEventListener('resize', debouncedUpdate);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', debouncedUpdate);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="沉浸式播放"
      tabIndex={-1}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      className="fixed inset-0 z-[60] bg-black overflow-hidden animate-fade-in"
      style={{ cursor: controlsVisible ? undefined : 'none' }}
    >
      {/* Background: visualizer + particles */}
      <ImmersiveBackground width={size.w} height={size.h} />

      {/* Main content: cover + track info on left, lyrics on right */}
      <div className="relative z-10 flex h-full">
        {/* Left side: cover + info */}
        <div className="w-1/2 min-w-0 flex flex-col items-center justify-center p-6 lg:p-12">
          <ImmersiveCover />
          <ImmersiveTrackInfo />
          {/* Viz mode switcher under track info */}
          <div className="mt-6">
            <VizModeSwitcher />
          </div>
        </div>

        {/* Right side: lyrics */}
        <div className="w-1/2 min-w-0 flex flex-col">
          <ImmersiveLyrics />
        </div>
      </div>

      {/* Bottom controls overlay */}
      <ImmersiveControls visible={controlsVisible} onClose={onClose} />
    </div>
  );
}
