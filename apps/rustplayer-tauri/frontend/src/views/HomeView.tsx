import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaylistStore } from '@/store/playlistStore';
import { useUiStore } from '@/store/uiStore';
import { ipc } from '@/lib/ipc';
import { sanitizeError } from '@/lib/errorMessages';
import CoverImage from '@/components/common/CoverImage';
import SourceBadge from '@/components/common/SourceBadge';
import HorizontalScroll from '@/components/common/HorizontalScroll';
import HomeRecommendations from '@/components/recommend/HomeRecommendations';
import { Search, Library, Compass, Maximize2, ArrowUpRight } from 'lucide-react';

type AccountState = { phase: 'loading' } | { phase: 'ready'; loggedIn: boolean } | { phase: 'error'; message: string };

export default function HomeView() {
  const recentTracks = usePlayerStore(state => state.recentTracks);
  const { playlists, loading, error, lastFetchedAt, fetchPlaylists } = usePlaylistStore();
  const immersiveOpen = useUiStore(state => state.immersiveOpen);
  const playlistsRef = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [account, setAccount] = useState<AccountState>({ phase: 'loading' });
  const [accountAttempt, setAccountAttempt] = useState(0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';

  useEffect(() => {
    let active = true;
    setAccount({ phase: 'loading' });
    ipc.checkLoginStatus()
      .then(status => { if (active) setAccount({ phase: 'ready', loggedIn: !!status.netease || !!status.qqmusic }); })
      .catch(reason => { if (active) setAccount({ phase: 'error', message: sanitizeError(reason) }); });
    return () => { active = false; };
  }, [accountAttempt, lastFetchedAt]);

  const showPlaylists = () => {
    const heading = playlistsRef.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  const loggedIn = account.phase === 'ready' && account.loggedIn;
  const visiblePlaylists = expanded ? playlists : playlists.slice(0, 6);

  return (
    <div className="home-page discovery-page">
      <header className="discovery-heading">
        <p className="home-eyebrow">拾音 · 你的音乐空间</p>
        <h1>{greeting}</h1>
        <p>接着听喜欢的旋律，也发现一些新的声音。</p>
      </header>

      <div className="home-shortcuts" aria-label="首页快捷入口">
        <Link to="/search"><Search size={21} /><span>搜索音乐<small>找歌曲、歌手或专辑</small></span></Link>
        <button onClick={showPlaylists}><Library size={21} /><span>我的歌单<small>浏览已同步的歌单</small></span></button>
        <Link to="/daily"><Compass size={21} /><span>智能推荐<small>发现精选与重温经典</small></span></Link>
        <button onClick={() => useUiStore.getState().setImmersiveOpen(true)} aria-haspopup="dialog" aria-expanded={immersiveOpen}>
          <Maximize2 size={21} /><span>播放详情<small>查看封面、歌词与场景</small></span>
        </button>
      </div>

      <section aria-labelledby="home-recent-title" className="home-section">
        <div className="discovery-section-heading"><h2 id="home-recent-title">继续收听</h2><span>最近播放</span></div>
        {recentTracks.length === 0 ? <div className="discovery-empty">
          <h3>还没有播放记录</h3><p>从一首喜欢的歌开始，这里会留下最近听过的音乐。</p>
          <Link className="discovery-link" to="/search">去搜索音乐 <ArrowUpRight size={15} /></Link>
        </div> : <HorizontalScroll>
          {recentTracks.map(track => <button key={`${track.source}:${track.id}`} className="home-recent-track"
            aria-label={`播放：${track.name}，${track.artist}`} title="播放这首，保留队列"
            onClick={() => void usePlayerStore.getState().playTrack(track)}>
            <CoverImage src={track.coverUrl} alt="" width={44} height={44} className="w-11 h-11 rounded-lg object-cover flex-shrink-0"
              fallbackClassName="w-11 h-11 rounded-lg bg-bg-elevated flex items-center justify-center flex-shrink-0" iconSize={18} resetKey={`${track.source}:${track.id}`} />
            <span className="min-w-0 flex-1"><strong title={track.name}>{track.name}</strong><small title={track.artist}>{track.artist}</small></span>
            <SourceBadge source={track.source} />
          </button>)}
        </HorizontalScroll>}
      </section>

      {account.phase === 'error' && <div className="discovery-notice is-error" role="status">
        <div><strong>暂时无法检查登录状态</strong><p>{account.message}</p></div>
        <button className="discovery-button" onClick={() => setAccountAttempt(value => value + 1)}>重试登录检查</button>
      </div>}

      <section aria-labelledby="home-playlists-title" className="home-section">
        <div className="discovery-section-heading">
          <h2 id="home-playlists-title" ref={playlistsRef} tabIndex={-1}>我的歌单</h2>
          {loggedIn && <button className="discovery-link" disabled={loading} onClick={() => void fetchPlaylists(undefined, true)}>刷新歌单</button>}
        </div>
        {account.phase === 'loading' && <p className="discovery-hint" role="status">正在检查音乐账号…</p>}
        {account.phase === 'ready' && !account.loggedIn && <div className="discovery-empty">
          <h3>登录后同步你的歌单</h3><p>连接网易云或 QQ音乐账号，在这里浏览自己的歌单。</p>
          <Link className="discovery-link" to="/settings">前往登录 <ArrowUpRight size={15} /></Link>
        </div>}
        {loggedIn && <>
          {loading && <p className="discovery-hint" role="status">正在同步歌单…</p>}
          {error && <div className="discovery-notice is-error" role="status"><div>
            <strong>{playlists.length ? '歌单刷新失败，保留已同步歌单' : '歌单获取失败'}</strong><p>{error}</p></div>
            <button className="discovery-button" disabled={loading} onClick={() => void fetchPlaylists(undefined, true)}>重试歌单</button>
          </div>}
          {!loading && !error && !playlists.length && <div className="discovery-empty"><h3>暂时没有歌单</h3>
            <p>在音乐平台创建或收藏歌单后，点击“刷新歌单”同步到这里。</p></div>}
          {playlists.length > 0 && <>
            <div className="home-playlists">
              {visiblePlaylists.map(playlist => <Link key={`${playlist.source}:${playlist.id}`} to={`/playlist/${playlist.source}/${playlist.id}`}
                className="home-playlist" aria-label={`打开歌单：${playlist.name}`}>
                <CoverImage src={playlist.coverUrl} alt="" width={56} height={56} className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                  fallbackClassName="w-14 h-14 rounded-lg bg-bg-elevated flex items-center justify-center flex-shrink-0" iconSize={22} resetKey={`${playlist.source}:${playlist.id}`} />
                <span className="min-w-0 flex-1"><strong title={playlist.name}>{playlist.name}</strong><SourceBadge source={playlist.source} /></span>
                <ArrowUpRight size={17} className="text-text-tertiary flex-shrink-0" aria-hidden="true" />
              </Link>)}
            </div>
            {playlists.length > 6 && <button className="discovery-link mt-3" aria-expanded={expanded}
              onClick={() => setExpanded(value => !value)}>{expanded ? '收起歌单' : `查看全部 ${playlists.length} 个歌单`}</button>}
          </>}
        </>}
      </section>

      <section aria-labelledby="home-recommend-title" className="home-section">
        <div className="discovery-section-heading"><h2 id="home-recommend-title">智能推荐</h2>
          <Link className="discovery-link" to="/daily">查看全部推荐 <ArrowUpRight size={15} /></Link></div>
        {account.phase === 'loading' && <p className="discovery-hint">正在检查音乐账号…</p>}
        {account.phase === 'ready' && !account.loggedIn && <div className="discovery-empty">
          <h3>登录后发现更多音乐</h3><p>从已登录音源获取精选，随着收听积累发现更合口味的歌曲。</p>
          <Link className="discovery-link" to="/settings">前往登录 <ArrowUpRight size={15} /></Link>
        </div>}
        {loggedIn && <HomeRecommendations />}
      </section>
    </div>
  );
}
