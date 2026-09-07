import { useEffect } from 'react';
import { useRecommendStore } from '@/store/recommendStore';
import TrackCard from './TrackCard';

export default function HomeRecommendations() {
  const { personalized, rediscover, discovery, loading, error, fetchRecommendations } = useRecommendStore();
  useEffect(() => {
    if (!discovery && !loading && !error) void fetchRecommendations();
  }, [discovery, loading, error, fetchRecommendations]);

  const tracks = personalized.length ? personalized : rediscover;
  const unavailable = discovery?.outcome === 'unavailable';
  const sourceNames = discovery?.availableSources.map(source => source === 'netease' ? '网易云' : 'QQ音乐').join(' / ');

  return <>
    {loading && <p className="discovery-hint" role="status">正在获取推荐…</p>}
    {(error || unavailable) && <div className="discovery-notice is-error" role="status">
      <div><strong>{tracks.length && error ? '推荐刷新失败，保留上次结果' : '暂时无法获取推荐'}</strong><p>请稍后重试，或在设置中检查音乐账号。</p></div>
      <button className="discovery-button" disabled={loading} onClick={() => void fetchRecommendations(true)}>重试推荐</button>
    </div>}
    {!loading && !error && !unavailable && !tracks.length && <div className="discovery-empty">
      <h3>暂时没有推荐歌曲</h3><p>可以稍后刷新，或先搜索想听的音乐。</p>
      <button className="discovery-button" onClick={() => void fetchRecommendations(true)}>刷新推荐</button>
    </div>}
    {!unavailable && tracks.length > 0 && <>
      <div className="discovery-section-meta">
        <p>{personalized.length ? `为你精选 · 来自 ${sourceNames}` : '暂无新精选，先重温经典'}</p>
        <button className="discovery-link" disabled={loading} onClick={() => void fetchRecommendations(true)}>刷新推荐</button>
      </div>
      {discovery?.outcome === 'degraded' && <p className="discovery-hint" role="status">部分音源暂不可用，当前来自：{sourceNames}</p>}
      <div className="home-recommendations">{tracks.slice(0, 4).map(track => <TrackCard key={`${track.source}:${track.id}`} track={track} />)}</div>
    </>}
  </>;
}
