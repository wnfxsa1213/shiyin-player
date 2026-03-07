import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ipc, type MusicSource } from '@/lib/ipc';
import type { Track } from '@/store/playerStore';
import { usePlayerStore } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { sanitizeError } from '@/lib/errorMessages';
import BackButton from '@/components/common/BackButton';
import VirtualTrackList from '@/components/common/VirtualTrackList';
import { Play, Shuffle, CalendarDays, LogIn } from 'lucide-react';

const SOURCES: { key: MusicSource; label: string }[] = [
  { key: 'netease', label: '网易云' },
  { key: 'qqmusic', label: 'QQ音乐' },
];

export default function DailyRecommendView() {
  const navigate = useNavigate();
  const [source, setSource] = useState<MusicSource>('netease');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Check login status for current source
  useEffect(() => {
    let active = true;
    setIsLoggedIn(null);
    ipc.checkLoginStatus()
      .then((status) => { if (active) setIsLoggedIn(!!status[source]); })
      .catch(() => { if (active) setIsLoggedIn(false); });
    return () => { active = false; };
  }, [source, retryKey]);

  // Fetch daily recommendations when logged in
  useEffect(() => {
    if (isLoggedIn !== true) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(false);
    setTracks([]);
    ipc.getDailyRecommend(source)
      .then((data) => { if (active) setTracks(data); })
      .catch((err) => {
        if (active) {
          setError(true);
          useToastStore.getState().addToast('error', sanitizeError(err));
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [source, isLoggedIn, retryKey]);

  const handlePlayAll = () => {
    if (!tracks.length) return;
    const store = usePlayerStore.getState();
    store.clearQueue();
    store.addToQueue(tracks);
    store.playFromQueue(0);
  };

  const handleShuffleAll = () => {
    if (!tracks.length) return;
    const store = usePlayerStore.getState();
    store.clearQueue();
    store.addToQueue(tracks);
    store.setPlayMode('shuffle');
    store.playFromQueue(0);
  };

  const today = new Date();
  const day = today.getDate();
  const month = today.getMonth() + 1;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[today.getDay()];
  const sourceName = source === 'netease' ? '网易云' : 'QQ音乐';

  const showSkeleton = loading || isLoggedIn === null;
  const showEmptyState = !showSkeleton && isLoggedIn === false;
  const showError = !showSkeleton && isLoggedIn === true && error && tracks.length === 0;
  const showData = !showSkeleton && isLoggedIn === true && !error && tracks.length > 0;
  const showEmpty = !showSkeleton && isLoggedIn === true && !error && !loading && tracks.length === 0;

  return (
    <div className="flex flex-col h-full pb-28">
      <BackButton />

      {/* Source tabs */}
      <div className="px-8 pt-2 flex gap-2 animate-fade-in-up" role="tablist" aria-label="音源选择">
        {SOURCES.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={source === s.key}
            onClick={() => setSource(s.key)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors duration-200 cursor-pointer
              focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              source === s.key
                ? 'bg-gradient-accent text-white font-medium shadow-sm'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Skeleton loading */}
      {showSkeleton && (
        <div className="p-8 space-y-4 animate-pulse" role="status" aria-busy="true" aria-label="加载中">
          <div className="flex gap-6">
            <div className="w-40 h-40 bg-bg-secondary rounded-xl" />
            <div className="flex-1 space-y-3 py-2">
              <div className="h-7 bg-bg-secondary rounded w-1/4" />
              <div className="h-4 bg-bg-secondary rounded w-2/3" />
              <div className="h-4 bg-bg-secondary rounded w-1/4" />
              <div className="flex gap-3 mt-3">
                <div className="h-10 bg-bg-secondary rounded-full w-28" />
                <div className="h-10 bg-bg-secondary rounded-full w-28" />
              </div>
            </div>
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center px-4 py-2.5 gap-3">
              <div className="w-8 h-4 bg-bg-secondary rounded" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-bg-secondary rounded w-2/3" />
                <div className="h-3 bg-bg-secondary rounded w-1/3" />
              </div>
              <div className="w-16 h-3 bg-bg-secondary rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Not logged in: empty state */}
      {showEmptyState && (
        <div className="text-center py-16 animate-fade-in-up">
          <CalendarDays
            size={64}
            strokeWidth={1}
            className="text-text-tertiary mx-auto mb-4 opacity-50"
            aria-hidden="true"
          />
          <p className="text-text-primary font-medium text-lg mb-2">
            登录后查看每日推荐
          </p>
          <p className="text-text-tertiary text-sm mb-6 max-w-xs mx-auto">
            登录{sourceName}账号，获取为你量身定制的每日歌曲推荐
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

      {/* Data loaded successfully */}
      {showData && (
        <>
          <div className="p-8 pb-0 animate-fade-in-up">
            <div className="flex gap-6 mb-8">
              {/* Date cover */}
              <div className="w-40 h-40 rounded-xl bg-gradient-accent flex flex-col items-center justify-center shadow-md flex-shrink-0">
                <span className="text-white/80 text-sm font-medium">{weekday}</span>
                <span className="text-white text-5xl font-bold leading-none mt-1">{day}</span>
                <span className="text-white/80 text-sm mt-1">{month}月</span>
              </div>
              {/* Info */}
              <div className="flex flex-col justify-center gap-2">
                <h1 className="text-2xl font-bold">每日推荐</h1>
                <p className="text-sm text-text-secondary">
                  根据你的听歌口味生成 · {month}月{day}日 {weekday}
                </p>
                <p className="text-xs text-text-tertiary">
                  {tracks.length} 首歌曲 · {sourceName}
                </p>
                <div className="flex gap-3 mt-2">
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
                    className="flex items-center gap-2 px-5 py-2 bg-bg-secondary text-text-primary rounded-full
                      text-sm hover:bg-bg-hover transition-colors cursor-pointer
                      focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    <Shuffle size={16} strokeWidth={1.5} /> 随机播放
                  </button>
                </div>
              </div>
            </div>
          </div>
          <VirtualTrackList tracks={tracks} />
        </>
      )}

      {/* Error state */}
      {showError && (
        <div className="text-center py-16 animate-fade-in-up">
          <CalendarDays
            size={64}
            strokeWidth={1}
            className="text-text-tertiary mx-auto mb-4 opacity-50"
            aria-hidden="true"
          />
          <p className="text-text-tertiary mb-4">推荐歌曲加载失败</p>
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            className="px-4 py-2 bg-bg-secondary text-text-primary rounded-lg text-sm
              hover:bg-bg-hover transition-colors cursor-pointer
              focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            重试
          </button>
        </div>
      )}

      {/* Empty data (logged in but API returned nothing) */}
      {showEmpty && (
        <div className="text-center py-16 animate-fade-in-up">
          <CalendarDays
            size={64}
            strokeWidth={1}
            className="text-text-tertiary mx-auto mb-4 opacity-50"
            aria-hidden="true"
          />
          <p className="text-text-tertiary">今日暂无推荐歌曲</p>
        </div>
      )}
    </div>
  );
}
