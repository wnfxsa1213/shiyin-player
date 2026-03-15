import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ipc } from '@/lib/ipc';
import { usePlayerStore } from '@/store/playerStore';
import { useRecommendStore } from '@/store/recommendStore';
import BackButton from '@/components/common/BackButton';
import HorizontalScroll from '@/components/common/HorizontalScroll';
import VirtualTrackList from '@/components/common/VirtualTrackList';
import TrackCard from '@/components/recommend/TrackCard';
import ArtistCard from '@/components/recommend/ArtistCard';
import SectionSkeleton from '@/components/recommend/SectionSkeleton';
import { Play, Shuffle, CalendarDays, LogIn, RefreshCw, Sparkles, User, Clock } from 'lucide-react';

export default function DailyRecommendView() {
  const navigate = useNavigate();
  const [anyLoggedIn, setAnyLoggedIn] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { personalized, topArtists, rediscover, loading, error, fetchRecommendations, lastFetchedAt } = useRecommendStore();
  const [refreshing, setRefreshing] = useState(false);

  // Check if any source is logged in
  useEffect(() => {
    let active = true;
    ipc.checkLoginStatus()
      .then((status) => {
        if (active) setAnyLoggedIn(!!status.netease || !!status.qqmusic);
      })
      .catch(() => { if (active) setAnyLoggedIn(false); });
    return () => { active = false; };
  }, []);

  // Fetch recommendations once logged in
  useEffect(() => {
    if (anyLoggedIn === true && personalized.length === 0 && !loading) {
      fetchRecommendations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchRecommendations is stable (zustand)
  }, [anyLoggedIn, personalized.length, loading]);

  const handlePlayAll = () => {
    if (!personalized.length) return;
    const store = usePlayerStore.getState();
    store.clearQueue();
    store.addToQueue(personalized);
    store.playFromQueue(0);
  };

  const handleShuffleAll = () => {
    if (!personalized.length) return;
    const store = usePlayerStore.getState();
    store.clearQueue();
    store.addToQueue(personalized);
    store.setPlayMode('shuffle');
    store.playFromQueue(0);
  };

  const handleRefresh = async () => {
    const cooldownRemaining = 30_000 - (Date.now() - lastFetchedAt);
    if (cooldownRemaining > 0) return;
    setRefreshing(true);
    await fetchRecommendations();
    setRefreshing(false);
  };

  const today = new Date();
  const day = today.getDate();
  const month = today.getMonth() + 1;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[today.getDay()];

  const showSkeleton = loading || anyLoggedIn === null;
  const showNotLoggedIn = !showSkeleton && anyLoggedIn === false;
  const showError = !showSkeleton && anyLoggedIn === true && !!error && personalized.length === 0;
  const showData = !showSkeleton && personalized.length > 0;
  const showEmpty = !showSkeleton && anyLoggedIn === true && !error && !loading && personalized.length === 0;

  // For the card preview, show first 8 tracks
  const previewTracks = personalized.slice(0, 8);

  return (
    <div className="flex flex-col h-full pb-28 overflow-y-auto">
      <BackButton />

      {/* Header */}
      <div className="px-8 pt-2 animate-fade-in-up">
        <div className="flex gap-6 mb-6">
          {/* Date cover */}
          <div className="w-36 h-36 rounded-xl bg-gradient-accent flex flex-col items-center justify-center shadow-md flex-shrink-0">
            <span className="text-white/80 text-sm font-medium">{weekday}</span>
            <span className="text-white text-5xl font-bold leading-none mt-1">{day}</span>
            <span className="text-white/80 text-sm mt-1">{month}月</span>
          </div>
          {/* Info */}
          <div className="flex flex-col justify-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">每日推荐</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              根据你的听歌口味智能推荐 · {month}月{day}日
            </p>
            {showData && (
              <>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {personalized.length} 首精选歌曲 · 双音源混合
                </p>
                <div className="flex gap-3 mt-1">
                  <button
                    onClick={handlePlayAll}
                    className="flex items-center gap-2 px-5 py-2 bg-gradient-accent text-white rounded-full
                      text-sm font-medium hover:shadow-glow transition-shadow cursor-pointer
                      focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    <Play size={16} fill="currentColor" /> 播放全部
                  </button>
                  <button
                    onClick={handleShuffleAll}
                    className="flex items-center gap-2 px-5 py-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-full
                      text-sm hover:bg-[var(--bg-hover)] transition-colors cursor-pointer
                      focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    <Shuffle size={16} strokeWidth={1.5} /> 随机播放
                  </button>
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="flex items-center gap-1.5 px-3 py-2 bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-full
                      text-sm hover:bg-[var(--bg-hover)] transition-colors cursor-pointer disabled:opacity-50
                      focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    title="刷新推荐"
                  >
                    <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Skeleton loading */}
      {showSkeleton && (
        <div className="px-8 space-y-8 animate-pulse" role="status" aria-busy="true" aria-label="加载中">
          <div>
            <div className="h-5 bg-[var(--bg-secondary)] rounded w-24 mb-4" />
            <SectionSkeleton type="cards" />
          </div>
          <div>
            <div className="h-5 bg-[var(--bg-secondary)] rounded w-32 mb-4" />
            <SectionSkeleton type="artists" />
          </div>
        </div>
      )}

      {/* Not logged in */}
      {showNotLoggedIn && (
        <div className="text-center py-16 animate-fade-in-up">
          <CalendarDays size={64} strokeWidth={1} className="text-[var(--text-tertiary)] mx-auto mb-4 opacity-50" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-medium text-lg mb-2">登录后查看每日推荐</p>
          <p className="text-[var(--text-tertiary)] text-sm mb-6 max-w-xs mx-auto">
            登录任意音乐账号，获取智能推荐歌曲
          </p>
          <button
            onClick={() => navigate('/settings')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-accent text-white
              rounded-full text-sm font-medium hover:shadow-glow transition-shadow cursor-pointer
              focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <LogIn size={16} /> 前往登录
          </button>
        </div>
      )}

      {/* Main content sections */}
      {showData && (
        <div className="px-8 space-y-8 animate-fade-in-up">
          {/* Section 1: Personalized picks */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={18} className="text-[var(--accent)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">为你精选</h2>
            </div>
            {!expanded ? (
              <>
                <HorizontalScroll>
                  {previewTracks.map((track, i) => (
                    <TrackCard key={`${track.id}-${track.source}`} track={track} tracks={personalized} index={i} />
                  ))}
                </HorizontalScroll>
                {personalized.length > 8 && (
                  <button
                    onClick={() => setExpanded(true)}
                    className="mt-3 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors cursor-pointer"
                  >
                    展开查看全部 {personalized.length} 首 →
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => setExpanded(false)}
                  className="mb-2 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors cursor-pointer"
                >
                  ← 收起列表
                </button>
                <VirtualTrackList tracks={personalized} />
              </>
            )}
          </section>

          {/* Section 2: Recommended artists */}
          {topArtists.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <User size={18} className="text-[var(--accent-secondary)]" />
                <h2 className="text-lg font-bold text-[var(--text-primary)]">你可能喜欢的艺术家</h2>
              </div>
              <HorizontalScroll>
                {topArtists.map((artist) => (
                  <ArtistCard key={artist.artist} artist={artist} />
                ))}
              </HorizontalScroll>
            </section>
          )}

          {/* Section 3: Rediscover */}
          {rediscover.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Clock size={18} className="text-[var(--accent-tertiary)]" />
                <h2 className="text-lg font-bold text-[var(--text-primary)]">重温经典</h2>
              </div>
              <HorizontalScroll>
                {rediscover.map((track, i) => (
                  <TrackCard key={`${track.id}-${track.source}`} track={track} tracks={rediscover} index={i} />
                ))}
              </HorizontalScroll>
            </section>
          )}
        </div>
      )}

      {/* Error state */}
      {showError && (
        <div className="text-center py-16 animate-fade-in-up">
          <CalendarDays size={64} strokeWidth={1} className="text-[var(--text-tertiary)] mx-auto mb-4 opacity-50" aria-hidden="true" />
          <p className="text-[var(--text-tertiary)] mb-4">推荐歌曲加载失败</p>
          <button
            onClick={() => fetchRecommendations()}
            className="px-4 py-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-lg text-sm
              hover:bg-[var(--bg-hover)] transition-colors cursor-pointer
              focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            重试
          </button>
        </div>
      )}

      {/* Empty */}
      {showEmpty && (
        <div className="text-center py-16 animate-fade-in-up">
          <CalendarDays size={64} strokeWidth={1} className="text-[var(--text-tertiary)] mx-auto mb-4 opacity-50" aria-hidden="true" />
          <p className="text-[var(--text-tertiary)]">今日暂无推荐歌曲</p>
        </div>
      )}
    </div>
  );
}
