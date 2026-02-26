import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ipc, type Playlist } from '@/lib/ipc';
import { usePlayerStore } from '@/store/playerStore';
import BackButton from '@/components/common/BackButton';
import VirtualTrackList from '@/components/common/VirtualTrackList';
import CoverImage from '@/components/common/CoverImage';
import { Play, Shuffle } from 'lucide-react';

export default function PlaylistDetailView() {
  const { source, id } = useParams<{ source: string; id: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!source || !id) return;
    if (source !== 'netease' && source !== 'qqmusic') {
      setPlaylist(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setPlaylist(null);
    ipc.getPlaylistDetail(id, source)
      .then((data) => { if (active) setPlaylist(data); })
      .catch(console.error)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [source, id, retryKey]);

  const handlePlayAll = () => {
    if (!playlist?.tracks.length) return;
    const store = usePlayerStore.getState();
    store.clearQueue();
    store.addToQueue(playlist.tracks);
    store.playFromQueue(0);
  };

  const handleShuffleAll = () => {
    if (!playlist?.tracks.length) return;
    const store = usePlayerStore.getState();
    store.clearQueue();
    store.addToQueue(playlist.tracks);
    store.setPlayMode('shuffle');
    store.playFromQueue(0);
  };

  return (
    <div className="flex flex-col h-full pb-28">
      <BackButton />
      {loading && (
        <div className="p-8 space-y-4 animate-pulse" role="status" aria-busy="true" aria-label="加载中">
          <div className="flex gap-6">
            <div className="w-40 h-40 bg-bg-secondary rounded-xl" />
            <div className="flex-1 space-y-3 py-2">
              <div className="h-6 bg-bg-secondary rounded w-1/3" />
              <div className="h-4 bg-bg-secondary rounded w-2/3" />
              <div className="h-4 bg-bg-secondary rounded w-1/4" />
            </div>
          </div>
        </div>
      )}
      {!loading && playlist && (
        <>
          <div className="p-8 pb-0">
            <div className="flex gap-6 mb-8">
              <CoverImage
                    src={playlist.coverUrl}
                    alt={`${playlist.name} 封面`}
                    className="w-40 h-40 rounded-xl object-cover shadow-md"
                    fallbackClassName="w-40 h-40 rounded-xl bg-bg-secondary flex items-center justify-center"
                    iconSize={40}
                    fallbackIcon={<Play size={40} strokeWidth={1} className="text-text-tertiary" />}
                    resetKey={playlist.id}
                  />
              <div className="flex flex-col justify-center gap-2">
                <h1 className="text-2xl font-bold">{playlist.name}</h1>
                {playlist.description && (
                  <p className="text-sm text-text-secondary line-clamp-2">{playlist.description}</p>
                )}
                <p className="text-xs text-text-tertiary">{playlist.tracks.length} 首歌曲</p>
                <div className="flex gap-3 mt-2">
                  <button onClick={handlePlayAll} className="flex items-center gap-2 px-5 py-2 bg-gradient-accent text-white rounded-full text-sm font-medium hover:shadow-glow transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent focus-visible:outline-none">
                    <Play size={16} fill="currentColor" /> 播放全部
                  </button>
                  <button onClick={handleShuffleAll} className="flex items-center gap-2 px-5 py-2 bg-bg-secondary text-text-primary rounded-full text-sm hover:bg-bg-hover transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
                    <Shuffle size={16} strokeWidth={1.5} /> 随机播放
                  </button>
                </div>
              </div>
            </div>
          </div>
          <VirtualTrackList tracks={playlist.tracks} />
        </>
      )}
      {!loading && !playlist && (
        <div className="text-center py-16">
          <p className="text-text-tertiary mb-4">歌单加载失败</p>
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            className="px-4 py-2 bg-bg-secondary text-text-primary rounded-lg text-sm hover:bg-bg-hover transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}
