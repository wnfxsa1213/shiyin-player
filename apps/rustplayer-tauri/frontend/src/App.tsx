import { useEffect, useRef, useState } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LayoutGroup } from 'framer-motion';
import { useUiStore } from '@/store/uiStore';
import { usePlayerStore } from '@/store/playerStore';
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
import SettingsView from '@/views/SettingsView';
import PlaylistDetailView from '@/views/PlaylistDetailView';
import LyricsPanel from '@/components/player/LyricsPanel';
import QueuePanel from '@/components/player/QueuePanel';
import ToastContainer from '@/components/common/ToastContainer';
import ErrorBoundary from '@/components/common/ErrorBoundary';

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

export default function App() {
  const theme = useUiStore((s) => s.theme);
  // Use individual selectors for stable action references — avoids full-store subscription
  // that would cause App to re-render on every positionMs/durationMs update (~5Hz).
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const updateProgress = usePlayerStore((s) => s.updateProgress);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const [lyricsOpen, setLyricsOpen] = useState(false);
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

  useEffect(() => {
    const addToast = useToastStore.getState().addToast;
    const unsubs = [
      onPlayerState((state) => {
        if (state === 'playing') play();
        else if (state === 'paused') pause();
        else if (state === 'stopped') {
          if (playerErrorRef.current) {
            playerErrorRef.current = false;
            // Playback failed. Only skip auto-advance when playNext() would replay
            // the same failing track (single-track queue or repeat-one mode).
            // For multi-track queues, advance normally so the failing track is skipped.
            const { queue, playMode } = usePlayerStore.getState();
            const wouldReplaySame = playMode === 'repeat-one' || queue.length <= 1;
            if (wouldReplaySame) return;
          }
          usePlayerStore.getState().playNext();
        }
      }),
      onPlayerProgress(({ positionMs, durationMs }) => {
        updateProgress(positionMs, durationMs);
      }),
      onPlayerError((err) => {
        addToast('error', sanitizeError(err));
        playerErrorRef.current = true;
      }),
      onPlayerSpectrum(({ magnitudes }) => {
        // Write directly to shared ref — bypasses Zustand store to avoid ~15fps re-renders.
        // SpectrumVisualizer reads from this ref in its RAF loop.
        const arr = spectrumDataRef.current;
        // Float32Array.set() is a native optimized memcpy, faster than manual loop
        if (magnitudes.length <= arr.length) {
          arr.set(magnitudes);
        } else {
          arr.set(magnitudes.slice(0, arr.length));
        }
      }),
      onLoginSuccess((source) => {
        const name = source === 'netease' ? '网易云' : 'QQ音乐';
        addToast('success', `${name}登录成功`);
        usePlaylistStore.getState().fetchPlaylists(source, true).catch(() => {
          addToast('error', `${name}歌单获取失败，请稍后重试`);
        });
      }),
      onLoginTimeout((source) => {
        const name = source === 'netease' ? '网易云' : 'QQ音乐';
        addToast('error', `${name}登录超时，请重试`);
      }),
    ];
    return () => { unsubs.forEach((p) => p.then((fn) => fn())); };
  }, [play, pause, updateProgress]);

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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setVolume]);

  return (
    <MemoryRouter>
      <LayoutGroup>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[9999] focus:p-4 focus:bg-accent focus:text-white focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent">跳转到主内容</a>
        <PlayerAnnouncer />
        <div className="flex h-screen bg-bg-base text-text-primary overflow-hidden pb-20">
          <Sidebar />
          <main id="main-content" className="relative flex-1 overflow-y-auto bg-bg-base" tabIndex={-1}>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<HomeView />} />
                <Route path="/search" element={<SearchView />} />
                <Route path="/settings" element={<SettingsView />} />
                <Route path="/playlist/:source/:id" element={<PlaylistDetailView />} />
              </Routes>
            </ErrorBoundary>
            <LyricsPanel isOpen={lyricsOpen} onClose={() => setLyricsOpen(false)} />
            <QueuePanel isOpen={queueOpen} onClose={() => setQueueOpen(false)} />
          </main>
          <PlayerBar lyricsOpen={lyricsOpen} onToggleLyrics={() => setLyricsOpen(!lyricsOpen)} onToggleQueue={() => setQueueOpen(!queueOpen)} />
        </div>
      </LayoutGroup>
      <ToastContainer />
    </MemoryRouter>
  );
}
