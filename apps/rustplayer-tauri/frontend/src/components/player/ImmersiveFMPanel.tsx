import { useEffect, useState, useRef } from 'react';
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

  // Update size on resize
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
