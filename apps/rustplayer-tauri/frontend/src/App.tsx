import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useUiStore } from '@/store/uiStore';
import { usePlayerStore, flushPlayEvent } from '@/store/playerStore';
import { useVisualizerStore, spectrumDataRef } from '@/store/visualizerStore';
import { useToastStore } from '@/store/toastStore';
import { usePlaylistStore } from '@/store/playlistStore';
import { loadSetting } from '@/lib/settings';
import { ipc, onPlayerState, onPlayerProgress, onPlayerError, onPlayerSpectrum, onLoginSuccess, onLoginTimeout } from '@/lib/ipc';
import { sanitizeError } from '@/lib/errorMessages';
import { useDynamicTheme } from '@/hooks/useDynamicTheme';
import { usePlaylistAutoRefresh } from '@/hooks/usePlaylistAutoRefresh';
import Sidebar from '@/components/layout/Sidebar';
import PlayerBar from '@/components/layout/PlayerBar';
import HomeView from '@/views/HomeView';
import SearchView from '@/views/SearchView';
import ImmersiveFMPanel from '@/components/player/ImmersiveFMPanel';
import QueuePanel from '@/components/player/QueuePanel';
import ToastContainer from '@/components/common/ToastContainer';
import ErrorBoundary from '@/components/common/ErrorBoundary';

// Route-level code splitting — SettingsView and PlaylistDetailView are
// infrequently accessed; lazy-loading them reduces the initial JS bundle.
const SettingsView = lazy(() => import('@/views/SettingsView'));
const PlaylistDetailView = lazy(() => import('@/views/PlaylistDetailView'));
const DailyRecommendView = lazy(() => import('@/views/DailyRecommendView'));

/** Declarative ARIA live region that announces playback state and track changes to screen readers. */
function PlayerAnnouncer() {
  // Individual primitive selectors — avoids creating a new object on every selector call,
  // which would cause infinite re-renders via useSyncExternalStore mismatch detection.
  const playerState = usePlayerStore((s) => s.state);
  const track = usePlayerStore((s) => s.currentTrack);
  let text = '';
  if (playerState === 'playing' && track) {
    text = `正在播放：${track.name} - ${track.artist}`;
  } else if (playerState === 'paused') {
    text = '播放已暂停';
  }
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}

function RouteFallback() {
  return <div className="flex items-center justify-center h-full text-text-tertiary text-sm">加载中…</div>;
}

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const immersiveOpen = useUiStore((s) => s.immersiveOpen);
  const setImmersiveOpen = useUiStore((s) => s.setImmersiveOpen);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const [queueOpen, setQueueOpen] = useState(false);
  // Tracks whether the most recent player stop was caused by an error.
  // Used to prevent the stopped-event handler from retrying a failing track.
  const playerErrorRef = useRef(false);

  // 挂载全局动态主题萃取钩子
  useDynamicTheme();
  // 歌单自动刷新（启动 + 30 分钟定时 + 页面恢复可见）
  usePlaylistAutoRefresh();

  // 将前端运行时错误落盘到后端日志（release 下也能排查）
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const stack = e.error instanceof Error ? e.error.stack ?? '' : '';
      ipc.clientLog(
        'error',
        `window.error: ${e.message}\n${e.filename}:${e.lineno}:${e.colno}\n${stack}`,
      );
    };
    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = (() => {
        try {
          return typeof e.reason === 'string' ? e.reason : JSON.stringify(e.reason);
        } catch {
          return String(e.reason);
        }
      })();
      ipc.clientLog('error', `unhandledrejection: ${reason}`);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  // Load persisted settings on startup
  useEffect(() => {
    (async () => {
      try {
        const savedTheme = await loadSetting<'dark' | 'light'>('theme');
        if (savedTheme) useUiStore.setState({ theme: savedTheme });

        const savedVolume = await loadSetting<number>('volume');
        if (savedVolume !== null) {
          usePlayerStore.setState({ volume: savedVolume });
          ipc.setVolume(savedVolume).catch(console.error);
        }

        const vizEnabled = await loadSetting<boolean>('visualizer.enabled');
        if (vizEnabled !== null) useVisualizerStore.setState({ enabled: vizEnabled });
        const vizParticles = await loadSetting<boolean>('visualizer.showParticles');
        if (vizParticles !== null) useVisualizerStore.setState({ showParticles: vizParticles });
        const vizColors = await loadSetting<{ primary: string; secondary: string; particle: string }>('visualizer.colors');
        if (vizColors) useVisualizerStore.setState({ colors: vizColors });
        const vizMode = await loadSetting<'bars' | 'circle' | 'wave'>('visualizer.mode');
        if (vizMode) useVisualizerStore.setState({ visualizationMode: vizMode });
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
      // 歌单初始拉取由 usePlaylistAutoRefresh 在挂载时统一处理
    })();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
  }, [theme]);

  // Register all backend event listeners.
  // Uses empty dependency array — all store access is via getState() to avoid
  // re-subscription when action references change (fixes #45 event listener race
  // and #46 StrictMode double-registration).
  useEffect(() => {
    let active = true;
    const cleanups: (() => void)[] = [];
    const addToast = useToastStore.getState().addToast;

    Promise.all([
      onPlayerState((state) => {
        if (!active) return;
        if (state === 'playing') usePlayerStore.getState().play();
        else if (state === 'paused') usePlayerStore.getState().pause();
        else if (state === 'stopped') {
          // Always flush the current track's play event when playback stops
          flushPlayEvent();
          if (playerErrorRef.current) {
            playerErrorRef.current = false;
            const { queue, playMode } = usePlayerStore.getState();
            const wouldReplaySame = playMode === 'repeat-one' || queue.length <= 1;
            if (wouldReplaySame) return;
          }
          usePlayerStore.getState().playNext();
        }
      }),
      onPlayerProgress(({ positionMs, durationMs, emittedAtMs }) => {
        if (!active) return;
        usePlayerStore.getState().updateProgress(positionMs, durationMs, emittedAtMs);
      }),
      onPlayerError((err) => {
        if (!active) return;
        addToast('error', sanitizeError(err));
        playerErrorRef.current = true;
      }),
      onPlayerSpectrum(({ magnitudes }) => {
        if (!active) return;
        const arr = spectrumDataRef.current;
        const len = Math.min(magnitudes.length, arr.length);
        for (let i = 0; i < len; i++) arr[i] = magnitudes[i];
        for (let i = len; i < arr.length; i++) arr[i] = 0;
      }),
      onLoginSuccess((source) => {
        if (!active) return;
        const name = source === 'netease' ? '网易云' : 'QQ音乐';
        addToast('success', `${name}登录成功`);
        usePlaylistStore.getState().fetchPlaylists(source, true).catch(() => {
          addToast('error', `${name}歌单获取失败，请稍后重试`);
        });
      }),
      onLoginTimeout((source) => {
        if (!active) return;
        const name = source === 'netease' ? '网易云' : 'QQ音乐';
        addToast('error', `${name}登录超时，请重试`);
      }),
    ]).then((fns) => {
      if (active) {
        cleanups.push(...fns);
      } else {
        // Component unmounted before listeners resolved — clean up immediately
        fns.forEach((fn) => fn());
      }
    });

    // Flush the last track's play event when the window is closing
    const handleBeforeUnload = () => flushPlayEvent();
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      active = false;
      cleanups.forEach((fn) => fn());
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
      const st = usePlayerStore.getState();
      switch (e.code) {
        case 'Space':
          if (!st.currentTrack) return;
          e.preventDefault();
          ipc.togglePlayback();
          break;
        case 'ArrowUp': {
          e.preventDefault();
          const v = Math.min(1, st.volume + 0.05);
          ipc.setVolume(v);
          setVolume(v);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const v = Math.max(0, st.volume - 0.05);
          ipc.setVolume(v);
          setVolume(v);
          break;
        }
        case 'ArrowRight':
          e.preventDefault();
          ipc.seek(st.positionMs + 5000);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          ipc.seek(Math.max(0, st.positionMs - 5000));
          break;
        case 'KeyB':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            useUiStore.getState().toggleSidebar();
          }
          break;
        case 'Escape':
          if (useUiStore.getState().immersiveOpen) {
            e.preventDefault();
            useUiStore.getState().setImmersiveOpen(false);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setVolume]);

  return (
    <MemoryRouter>
      <a href="#main-content" className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-4 focus-visible:left-4 focus-visible:z-[9999] focus-visible:p-4 focus-visible:bg-accent focus-visible:text-white focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent">跳转到主内容</a>
      <PlayerAnnouncer />
      <div className="flex h-screen bg-bg-base text-text-primary overflow-hidden pb-24">
        <Sidebar />
        <main id="main-content" className="relative flex-1 overflow-y-auto bg-bg-base" tabIndex={-1}>
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<HomeView />} />
                <Route path="/search" element={<SearchView />} />
                <Route path="/settings" element={<SettingsView />} />
                <Route path="/playlist/:source/:id" element={<PlaylistDetailView />} />
                <Route path="/daily" element={<DailyRecommendView />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
          <ImmersiveFMPanel isOpen={immersiveOpen} onClose={() => setImmersiveOpen(false)} />
          <QueuePanel isOpen={queueOpen} onClose={() => setQueueOpen(false)} />
        </main>
        <PlayerBar lyricsOpen={immersiveOpen} onToggleLyrics={() => setImmersiveOpen(!immersiveOpen)} onToggleQueue={() => setQueueOpen(!queueOpen)} />
      </div>
      <ToastContainer />
    </MemoryRouter>
  );
}
