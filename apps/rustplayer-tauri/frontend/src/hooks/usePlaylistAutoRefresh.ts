import { useEffect } from 'react';
import { usePlaylistStore } from '@/store/playlistStore';

// 周期刷新间隔：30 分钟
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/**
 * 歌单自动刷新 Hook。
 *
 * 负责以下触发场景：
 * 1. 挂载时立即拉取（启动刷新）
 * 2. 每 30 分钟定时拉取（仅页面可见时触发）
 * 3. 页面从后台恢复可见时补偿拉取（依赖 store 内 lastFetchedAt 节流，不会重复请求）
 *
 * 定时器在组件卸载时自动清理，兼容 React 18 StrictMode 双挂载。
 */
export function usePlaylistAutoRefresh() {
  const fetchPlaylists = usePlaylistStore((s) => s.fetchPlaylists);

  useEffect(() => {
    // 1. 启动时拉取（force=false，走节流逻辑；首次 lastFetchedAt=0 必然通过）
    fetchPlaylists();

    // 2. 定时刷新：仅在页面可见时触发，减少后台无效请求
    const timerId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchPlaylists();
      }
    }, REFRESH_INTERVAL_MS);

    // 3. 可见性恢复时补偿刷新（store 内节流保证 5 分钟内不重复）
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchPlaylists();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchPlaylists]);
}
