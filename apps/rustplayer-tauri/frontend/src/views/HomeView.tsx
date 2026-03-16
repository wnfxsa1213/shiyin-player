import { useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaylistStore } from '@/store/playlistStore';
import { useToastStore } from '@/store/toastStore';
import { useUiStore } from '@/store/uiStore';
import CoverImage from '@/components/common/CoverImage';
import { Clock, Heart, Compass, Radio, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const cards: { label: string; icon: LucideIcon; gradient: string }[] = [
  { label: '最近播放', icon: Clock, gradient: 'bg-gradient-cool' },
  { label: '我的收藏', icon: Heart, gradient: 'bg-gradient-warm' },
  { label: '发现音乐', icon: Compass, gradient: 'bg-gradient-green' },
  { label: '电台', icon: Radio, gradient: 'bg-gradient-purple' },
];

const getScrollBehavior = (): ScrollBehavior => (
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
);

export default function HomeView() {
  const navigate = useNavigate();
  const recentTracks = usePlayerStore((s) => s.recentTracks);
  const playlists = usePlaylistStore((s) => s.playlists);
  const recentRef = useRef<HTMLElement>(null);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';

  const handleCardClick = (label: string) => {
    const toast = useToastStore.getState().addToast;
    switch (label) {
      case '最近播放':
        if (recentTracks.length === 0) {
          toast('info', '还没有播放记录');
        } else {
          recentRef.current?.scrollIntoView({ behavior: getScrollBehavior() });
        }
        break;
      case '我的收藏':
        if (playlists.length > 0) {
          navigate(`/playlist/${playlists[0].source}/${playlists[0].id}`);
        } else {
          toast('info', '登录后查看收藏歌单');
        }
        break;
      case '发现音乐':
        navigate('/search');
        break;
      case '电台':
        useUiStore.getState().setImmersiveOpen(true);
        break;
    }
  };
  const handlePlayRecent = (track: typeof recentTracks[number]) => {
    const store = usePlayerStore.getState();
    store.addToQueue([track]);
    const q = usePlayerStore.getState().queue;
    const idx = q.findIndex((t) => t.id === track.id && t.source === track.source);
    if (idx >= 0) store.playFromQueue(idx);
  };

  return (
    <div className="p-8 pb-28">
      <h1 className="text-3xl font-bold mb-1 text-gradient animate-fade-in-up">{greeting}</h1>
      <p className="text-text-secondary mb-8 text-sm animate-fade-in-up [animation-delay:50ms]">发现你喜欢的音乐</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-10">
        {cards.map((card, index) => (
          <button
            key={card.label}
            onClick={() => handleCardClick(card.label)}
            className="stagger-item aspect-square rounded-xl bg-bg-secondary flex flex-col items-center justify-center gap-3 text-text-secondary transition-colors duration-200 group animate-fade-in-up cursor-pointer hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
            style={{ animationDelay: `${(index + 1) * 100}ms` }}
          >
            <div className={`w-12 h-12 rounded-xl ${card.gradient} flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300`}>
              <card.icon size={24} strokeWidth={1.5} className="text-white" />
            </div>
            <span className="text-sm font-medium">{card.label}</span>
          </button>
        ))}
      </div>

      {/* 继续收听 */}
      <section ref={recentRef} className="mb-10 animate-fade-in-up [animation-delay:350ms]">
        <h2 className="text-lg font-semibold mb-4">继续收听</h2>
        {recentTracks.length === 0 ? (
          <p className="text-sm text-text-tertiary">播放一些音乐来填充这里</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recentTracks.map((track) => (
              <button
                key={`${track.source}-${track.id}`}
                onClick={() => handlePlayRecent(track)}
                className="flex-shrink-0 w-48 bg-bg-secondary rounded-xl p-3 flex items-center gap-3 group cursor-pointer hover:bg-bg-hover transition-colors text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <CoverImage
                  src={track.coverUrl}
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                  fallbackClassName="w-10 h-10 rounded-lg bg-bg-elevated flex items-center justify-center flex-shrink-0"
                  iconSize={16}
                  resetKey={track.id}
                />
                <div className="min-w-0">
                  <div className="text-sm truncate" title={track.name}>{track.name}</div>
                  <div className="text-xs text-text-secondary truncate" title={track.artist}>{track.artist}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
      {/* 为你推荐 */}
      <section className="animate-fade-in-up [animation-delay:450ms]">
        <h2 className="text-lg font-semibold mb-4">为你推荐</h2>
        {playlists.length === 0 ? (
          <p className="text-sm text-text-tertiary">登录后查看推荐歌单</p>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {playlists.slice(0, 5).map((pl) => (
              <Link
                key={`${pl.source}-${pl.id}`}
                to={`/playlist/${pl.source}/${pl.id}`}
                className="group text-left cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl block"
              >
                <div className="aspect-square rounded-xl bg-bg-secondary mb-2 flex items-center justify-center relative overflow-hidden hover:shadow-md transition-shadow duration-300">
                  <CoverImage
                    src={pl.coverUrl}
                    alt={`${pl.name} 封面`}
                    width={200}
                    height={200}
                    className="w-full h-full object-cover"
                    fallbackClassName="w-full h-full flex items-center justify-center"
                    iconSize={32}
                    resetKey={pl.id}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shadow-lg">
                      <Play size={16} fill="currentColor" className="text-white ml-0.5" />
                    </div>
                  </div>
                </div>
                <p className="text-sm text-text-secondary truncate" title={pl.name}>{pl.name}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
