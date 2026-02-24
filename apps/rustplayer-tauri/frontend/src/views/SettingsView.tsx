import { useState } from 'react';
import { useUiStore } from '@/store/uiStore';
import { useVisualizerStore, COLOR_PRESETS, type VisualizerMode } from '@/store/visualizerStore';
import { useToastStore } from '@/store/toastStore';
import { usePlaylistStore } from '@/store/playlistStore';
import { ipc } from '@/lib/ipc';

export default function SettingsView() {
  const { theme, toggleTheme } = useUiStore();
  const [cookie, setCookie] = useState('');
  const [source, setSource] = useState<'netease' | 'qqmusic'>('netease');
  const [loginLoading, setLoginLoading] = useState(false);

  const {
    enabled, mode, showParticles, colors,
    setEnabled, setMode, setShowParticles, setColors, applyPreset,
  } = useVisualizerStore();

  const handleLogin = async () => {
    if (!cookie.trim() || loginLoading) return;
    const toast = useToastStore.getState().addToast;
    setLoginLoading(true);
    try {
      await ipc.login(source, cookie);
      setCookie('');
      toast('success', '登录成功');
      usePlaylistStore.getState().fetchPlaylists();
    } catch (e) {
      toast('error', `登录失败: ${e}`);
    } finally {
      setLoginLoading(false);
    }
  };

  const modes: { value: VisualizerMode; label: string }[] = [
    { value: 'bars', label: '柱状' },
    { value: 'wave', label: '波形' },
    { value: 'circle', label: '环形' },
  ];

  return (
    <div className="p-8 max-w-2xl mx-auto pb-28">
      <h1 className="text-3xl font-bold mb-8">设置</h1>

      <section className="mb-6 bg-bg-secondary rounded-xl p-5">
        <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border-secondary">外观</h2>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary text-sm">主题</span>
          <button
            onClick={toggleTheme}
            className="px-4 py-2 bg-bg-hover rounded-lg text-sm text-text-primary hover:bg-bg-elevated transition-all duration-200 cursor-pointer"
          >
            {theme === 'dark' ? '浅色模式' : '深色模式'}
          </button>
        </div>
      </section>

      {/* Visualizer settings */}
      <section className="mb-6 bg-bg-secondary rounded-xl p-5">
        <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border-secondary">可视化</h2>

        <div className="flex items-center justify-between mb-4">
          <span className="text-text-secondary text-sm">启用可视化</span>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer relative ${enabled ? 'bg-accent' : 'bg-bg-hover'}`}
            role="switch" aria-checked={enabled}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${enabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <div className="flex items-center justify-between mb-4">
          <span className="text-text-secondary text-sm">粒子效果</span>
          <button
            onClick={() => setShowParticles(!showParticles)}
            className={`w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer relative ${showParticles ? 'bg-accent' : 'bg-bg-hover'}`}
            role="switch" aria-checked={showParticles}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${showParticles ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <div className="mb-4">
          <span className="text-text-secondary text-sm block mb-2">模式</span>
          <div className="flex gap-2">
            {modes.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`px-4 py-1.5 rounded-full text-sm transition-all duration-200 cursor-pointer ${
                  mode === m.value
                    ? 'bg-gradient-accent text-white font-medium'
                    : 'bg-bg-hover text-text-secondary hover:text-text-primary'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <span className="text-text-secondary text-sm block mb-2">预设配色</span>
          <div className="flex gap-2">
            {COLOR_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p.name)}
                className="w-8 h-8 rounded-full border-2 transition-all duration-200 cursor-pointer hover:scale-110"
                style={{ background: `linear-gradient(135deg, ${p.primary}, ${p.secondary})`, borderColor: colors.primary === p.primary ? 'var(--accent)' : 'transparent' }}
                aria-label={p.name}
                title={p.name}
              />
            ))}
          </div>
        </div>

        <div>
          <span className="text-text-secondary text-sm block mb-2">自定义颜色</span>
          <div className="flex gap-4">
            {(['primary', 'secondary', 'particle'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-xs text-text-tertiary">
                <input
                  type="color"
                  value={colors[key]}
                  onChange={(e) => setColors({ ...colors, [key]: e.target.value })}
                  className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent"
                />
                {key === 'primary' ? '主色' : key === 'secondary' ? '副色' : '粒子'}
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-bg-secondary rounded-xl p-5">
        <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border-secondary">账号</h2>
        <div className="flex gap-2 mb-4">
          {(['netease', 'qqmusic'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`px-3 py-1.5 rounded-full text-sm transition-all duration-200 cursor-pointer ${
                source === s
                  ? 'bg-accent text-white font-medium'
                  : 'bg-bg-hover text-text-secondary hover:text-text-primary'
              }`}
            >
              {s === 'netease' ? '网易云' : 'QQ音乐'}
            </button>
          ))}
        </div>
        <p className="text-sm text-text-tertiary mb-3">粘贴 Cookie 以获取高级权限</p>
        <div className="flex gap-2">
          <input
            type="password"
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="MUSIC_U=..."
            className="flex-1 bg-bg-base border border-border-primary px-4 py-2 rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-subtle transition-all duration-200 text-sm"
          />
          <button
            onClick={handleLogin}
            disabled={loginLoading || !cookie.trim()}
            className={`px-5 py-2 bg-accent text-white rounded-lg font-medium transition-all duration-200 ${
              loginLoading || !cookie.trim()
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-accent-hover active:bg-accent-active cursor-pointer'
            }`}
          >
            {loginLoading ? '登录中...' : '登录'}
          </button>
        </div>
      </section>
    </div>
  );
}