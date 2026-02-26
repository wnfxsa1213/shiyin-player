import { useState, useEffect } from 'react';
import { LogIn, Loader2, CheckCircle, Info, ChevronRight } from 'lucide-react';
import { useUiStore } from '@/store/uiStore';
import { useVisualizerStore, COLOR_PRESETS, type VisualizerMode } from '@/store/visualizerStore';
import { useToastStore } from '@/store/toastStore';
import { sanitizeError } from '@/lib/errorMessages';
import { ipc, onLoginSuccess, onLoginTimeout, type MusicSource } from '@/lib/ipc';

type LoginStatus = 'idle' | 'webview-pending' | 'cookie-submitting' | 'logged-in';

export default function SettingsView() {
  const { theme, toggleTheme } = useUiStore();
  const [cookie, setCookie] = useState('');
  const [source, setSource] = useState<MusicSource>('netease');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loginStatusMap, setLoginStatusMap] = useState<Record<MusicSource, LoginStatus>>({
    netease: 'idle',
    qqmusic: 'idle',
  });

  const {
    enabled, mode, showParticles, colors,
    setEnabled, setMode, setShowParticles, setColors, applyPreset,
  } = useVisualizerStore();

  const loginStatus = loginStatusMap[source];

  // Fetch initial login status on mount
  useEffect(() => {
    ipc.checkLoginStatus().then((status) => {
      setLoginStatusMap((prev) => ({
        netease: status.netease ? 'logged-in' : prev.netease === 'logged-in' ? 'idle' : prev.netease,
        qqmusic: status.qqmusic ? 'logged-in' : prev.qqmusic === 'logged-in' ? 'idle' : prev.qqmusic,
      }));
    }).catch(() => {});
  }, []);

  // Listen for login success/timeout events to update local status
  useEffect(() => {
    const unsubs = [
      onLoginSuccess((src) => {
        setLoginStatusMap((prev) => ({ ...prev, [src]: 'logged-in' as LoginStatus }));
      }),
      onLoginTimeout((src) => {
        setLoginStatusMap((prev) => ({
          ...prev,
          [src]: prev[src] === 'webview-pending' ? 'idle' as LoginStatus : prev[src],
        }));
      }),
    ];
    return () => { unsubs.forEach((p) => p.then((fn) => fn())); };
  }, []);

  const handleWebViewLogin = async () => {
    if (loginStatus !== 'idle') return;
    const toast = useToastStore.getState().addToast;
    setLoginStatusMap((prev) => ({ ...prev, [source]: 'webview-pending' as LoginStatus }));
    try {
      await ipc.openLoginWindow(source);
    } catch (e) {
      toast('error', `打开登录窗口失败: ${sanitizeError(e)}`);
      setLoginStatusMap((prev) => ({ ...prev, [source]: 'idle' as LoginStatus }));
    }
  };

  const handleCookieLogin = async () => {
    if (!cookie.trim() || loginStatus === 'cookie-submitting') return;
    const toast = useToastStore.getState().addToast;
    setLoginStatusMap((prev) => ({ ...prev, [source]: 'cookie-submitting' as LoginStatus }));
    try {
      await ipc.login(source, cookie);
      setCookie('');
      // Status update and toast are handled by the global onLoginSuccess listener
    } catch (e) {
      toast('error', `登录失败: ${sanitizeError(e)}`);
      setLoginStatusMap((prev) => ({ ...prev, [source]: 'idle' as LoginStatus }));
    }
  };

  const handleLogout = async () => {
    const toast = useToastStore.getState().addToast;
    try {
      await ipc.logout(source);
      setLoginStatusMap((prev) => ({ ...prev, [source]: 'idle' as LoginStatus }));
      toast('success', '已登出');
    } catch (e) {
      toast('error', `登出失败: ${sanitizeError(e)}`);
    }
  };

  const modes: { value: VisualizerMode; label: string }[] = [
    { value: 'bars', label: '柱状' },
    { value: 'wave', label: '波形' },
    { value: 'circle', label: '环形' },
  ];

  const isLoading = loginStatus === 'webview-pending' || loginStatus === 'cookie-submitting';

  return (
    <div className="p-8 max-w-2xl mx-auto pb-28">
      <h1 className="text-3xl font-bold mb-8">设置</h1>

      <section className="mb-6 bg-bg-secondary rounded-xl p-5">
        <h2 className="text-base font-semibold mb-4 pb-2 border-b border-border-secondary">外观</h2>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary text-sm">主题</span>
          <button
            onClick={toggleTheme}
            className="px-4 py-2 bg-bg-hover rounded-lg text-sm text-text-primary hover:bg-bg-elevated transition-all duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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
            className={`w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer relative focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${enabled ? 'bg-accent' : 'bg-bg-hover'}`}
            role="switch" aria-checked={enabled}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${enabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <div className="flex items-center justify-between mb-4">
          <span className="text-text-secondary text-sm">粒子效果</span>
          <button
            onClick={() => setShowParticles(!showParticles)}
            className={`w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer relative focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${showParticles ? 'bg-accent' : 'bg-bg-hover'}`}
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
                className={`px-4 py-1.5 rounded-full text-sm transition-all duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
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
                className="w-8 h-8 rounded-full border-2 transition-all duration-200 cursor-pointer hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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
                  className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                />
                {key === 'primary' ? '主色' : key === 'secondary' ? '副色' : '粒子'}
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-bg-secondary rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-secondary">
          <h2 className="text-base font-semibold">账号</h2>
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              loginStatus === 'logged-in' ? 'bg-green-500' :
              isLoading ? 'bg-accent animate-pulse' : 'bg-text-tertiary'
            }`} />
            <span className="text-xs text-text-tertiary">
              {loginStatus === 'logged-in' ? '已登录' : isLoading ? '登录中' : '未登录'}
            </span>
          </span>
        </div>

        {/* Source selector */}
        <div className="flex gap-2 mb-4">
          {(['netease', 'qqmusic'] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setSource(s); setCookie(''); }}
              disabled={loginStatus === 'webview-pending'}
              className={`px-3 py-1.5 rounded-full text-sm transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                loginStatus === 'webview-pending'
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer'
              } ${
                source === s
                  ? 'bg-accent text-white font-medium'
                  : 'bg-bg-hover text-text-secondary hover:text-text-primary'
              }`}
            >
              {s === 'netease' ? '网易云' : 'QQ音乐'}
            </button>
          ))}
        </div>

        {loginStatus === 'logged-in' ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-text-primary">
              <CheckCircle className="w-4 h-4 text-green-500" />
              已登录
            </span>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-sm rounded-lg text-text-secondary hover:text-red-400 bg-bg-hover hover:bg-red-500/10 transition-all duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              登出
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={handleWebViewLogin}
              disabled={isLoading}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                isLoading
                  ? 'bg-accent/60 text-white/80 cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent-hover active:bg-accent-active cursor-pointer'
              }`}
            >
              {loginStatus === 'webview-pending' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 等待登录窗口…</>
              ) : (
                <><LogIn className="w-4 h-4" /> 一键登录</>
              )}
            </button>

            {loginStatus === 'webview-pending' && (
              <p className="flex items-center gap-1.5 text-sm text-text-tertiary mt-3">
                <Info className="w-4 h-4 shrink-0" /> 请在弹出的窗口中完成登录
              </p>
            )}

            {/* Advanced: manual cookie input */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors duration-200 select-none mt-4 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded"
              aria-expanded={showAdvanced}
              aria-controls="advanced-cookie-section"
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`} />
              高级选项
            </button>

            <div
              id="advanced-cookie-section"
              role="region"
              inert={!showAdvanced || undefined}
              className={`grid transition-all duration-300 ${showAdvanced ? 'grid-rows-[1fr] mt-3' : 'grid-rows-[0fr]'}`}
            >
              <div className="overflow-hidden">
                <p className="text-sm text-text-tertiary mb-2">手动粘贴 Cookie</p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={cookie}
                    onChange={(e) => setCookie(e.target.value)}
                    placeholder="MUSIC_U=..."
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 bg-bg-base border border-border-primary px-4 py-2 rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-subtle transition-all duration-200 text-sm"
                  />
                  <button
                    onClick={handleCookieLogin}
                    disabled={loginStatus === 'cookie-submitting' || !cookie.trim()}
                    className={`px-5 py-2 bg-accent text-white rounded-lg font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent focus-visible:outline-none ${
                      loginStatus === 'cookie-submitting' || !cookie.trim()
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-accent-hover active:bg-accent-active cursor-pointer'
                    }`}
                  >
                    {loginStatus === 'cookie-submitting' ? '登录中…' : '登录'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
