import { memo } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Music } from 'lucide-react';

export default memo(function ImmersiveTrackInfo() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  return (
    <div className="text-center mt-6 px-4 max-w-md mx-auto">
      {currentTrack ? (
        <>
          <h2 className="text-2xl font-bold text-white truncate">
            {currentTrack.name}
          </h2>
          <p className="text-lg text-white/70 truncate mt-1">
            {currentTrack.artist}
          </p>
        </>
      ) : (
        <div className="flex items-center justify-center gap-2 text-white/50">
          <Music size={20} />
          <span className="text-lg">未在播放</span>
        </div>
      )}
    </div>
  );
});
