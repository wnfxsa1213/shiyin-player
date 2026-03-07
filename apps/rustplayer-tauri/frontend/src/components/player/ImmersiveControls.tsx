import PlaybackProgress from '@/components/player/PlaybackProgress';
import FMControlBar from '@/components/player/FMControlBar';
import { X } from 'lucide-react';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function ImmersiveControls({ visible, onClose }: Props) {
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-[70] transition-all duration-300 ${
        visible
          ? 'translate-y-0 opacity-100'
          : 'translate-y-full opacity-0 pointer-events-none'
      }`}
      aria-hidden={!visible}
    >
      <div className="backdrop-blur-xl bg-black/30 border-t border-white/10 px-8 py-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {/* Controls row
              先放主控制按钮，再放进度条，和底栏播放器保持一致的视觉节奏 */}
          <div className="relative flex items-center justify-center">
            <FMControlBar />

            {/* Right: Close button */}
            <button
              onClick={onClose}
              className="absolute right-0 w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              aria-label="退出沉浸模式"
            >
              <X size={20} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="[&_span]:text-white/60 [&_input]:accent-white">
            <PlaybackProgress />
          </div>
        </div>
      </div>
    </div>
  );
}
