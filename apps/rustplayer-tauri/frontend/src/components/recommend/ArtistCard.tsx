import { useNavigate } from 'react-router-dom';
import type { ArtistPreference } from '@/lib/ipc';

interface ArtistCardProps {
  artist: ArtistPreference;
}

export default function ArtistCard({ artist }: ArtistCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/search?q=${encodeURIComponent(artist.artist)}`);
  };

  return (
    <button
      onClick={handleClick}
      className="group flex flex-col items-center w-[120px] flex-shrink-0 py-3 rounded-lg
        hover:bg-[var(--bg-hover)] transition-colors cursor-pointer
        focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
    >
      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-secondary)]
        flex items-center justify-center text-white text-2xl font-bold
        group-hover:shadow-glow transition-shadow">
        {artist.artist.charAt(0).toUpperCase()}
      </div>
      <p className="text-sm font-medium text-[var(--text-primary)] mt-2 truncate w-full text-center px-1">
        {artist.artist}
      </p>
      <p className="text-[10px] text-[var(--text-tertiary)]">
        {artist.playCount} 次播放
      </p>
    </button>
  );
}
