import { useEffect, useState } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LayoutGroup } from 'framer-motion';
import { useUiStore } from '@/store/uiStore';
import { usePlayerStore } from '@/store/playerStore';
import { useVisualizerStore } from '@/store/visualizerStore';
import { useToastStore } from '@/store/toastStore';
import { usePlaylistStore } from '@/store/playlistStore';
import { loadSetting } from '@/lib/settings';
import { ipc, onPlayerState, onPlayerProgress, onPlayerError, onPlayerSpectrum } from '@/lib/ipc';
import { useDynamicTheme } from '@/hooks/useDynamicTheme';
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

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const { play, pause, updateProgress, setVolume } = usePlayerStore();
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  // 挂载全局动态主题萃取钩子
  useDynamicTheme();

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
        const vizMode = await loadSetting<string>('visualizer.mode');
        if (vizMode) useVisualizerStore.setState({ mode: vizMode as any });
        const vizParticles = await loadSetting<boolean>('visualizer.showParticles');
        if (vizParticles !== null) useVisualizerStore.setState({ showParticles: vizParticles });
        const vizColors = await loadSetting<{ primary: string; secondary: string; particle: string }>('visualizer.colors');
        if (vizColors) useVisualizerStore.setState({ colors: vizColors });
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
      usePlaylistStore.getState().fetchPlaylists();
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
          usePlayerStore.getState().playNext();
        }
      }),
      onPlayerProgress(({ positionMs, durationMs }) => {
        updateProgress(positionMs, durationMs);
      }),
      onPlayerError((err) => {
        addToast('error', String(err));
      }),
      onPlayerSpectrum(({ magnitudes }) => {
        useVisualizerStore.getState().updateMagnitudes(magnitudes);
      }),
    ];
    return () => { unsubs.forEach((p) => p.then((fn) => fn())); };
  }, [play, pause, updateProgress]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
        <div className="flex h-screen bg-bg-base text-text-primary overflow-hidden pb-20">
          <Sidebar />
          <main className="relative flex-1 overflow-y-auto bg-bg-base" tabIndex={-1}>
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
