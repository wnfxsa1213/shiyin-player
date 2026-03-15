[根目录](../../../CLAUDE.md) > [apps](../../) > [rustplayer-tauri](../) > **frontend**

# apps/rustplayer-tauri/frontend - React 前端

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-03-15T11:22:14 | 增量更新 | 新增沉浸模式（ImmersiveFMPanel 组件族）、每日推荐页、FM 电台 store、推荐 store、行为追踪、IPC 自动重试、路由懒加载、FullscreenVisualizer GPU 优化 |
| 2026-02-27T16:32:02 | 增量更新 | 新增 traceId 自动生成、错误消息国际化、前端日志转发、登录事件监听 |
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |

## 模块职责

Tauri 应用的前端 UI 层。基于 React 18 + TypeScript + Tailwind CSS 构建，提供搜索、播放控制、歌词显示、频谱可视化、歌单管理、每日推荐、沉浸式播放模式、FM 电台、设置等完整用户界面。

## 入口与启动

- 入口文件：`src/main.tsx` -> `src/App.tsx`
- Vite dev server 端口：1420
- 路由：MemoryRouter（Home / Search / Settings / PlaylistDetail / Daily）
- 代码分割：`SettingsView`、`PlaylistDetailView`、`DailyRecommendView` 使用 `React.lazy()` 懒加载

## 对外接口

### IPC 封装 (`src/lib/ipc.ts`)

所有与 Rust 后端的通信集中在此文件，每次调用自动生成 traceId，支持自动重试：

**自动重试机制**：`network` 和 `rate_limited` 错误自动重试最多 2 次，指数退避（200ms -> 400ms）。

| IPC 方法 | 后端 Command | 说明 |
|----------|-------------|------|
| `ipc.searchMusic(query, source?)` | `search_music` | 搜索 |
| `ipc.playTrack(track)` | `play_track` | 播放 |
| `ipc.togglePlayback()` | `toggle_playback` | 播放/暂停 |
| `ipc.seek(positionMs)` | `seek` | 跳转 |
| `ipc.setVolume(volume)` | `set_volume` | 音量 |
| `ipc.getLyrics(trackId, source)` | `get_lyrics` | 歌词 |
| `ipc.login(source, cookie)` | `login` | 登录 |
| `ipc.logout(source)` | `logout` | 登出 |
| `ipc.openLoginWindow(source)` | `open_login_window` | WebView 登录 |
| `ipc.checkLoginStatus()` | `check_login_status` | 登录状态 |
| `ipc.getUserPlaylists(source?)` | `get_user_playlists` | 歌单列表 |
| `ipc.getPlaylistDetail(id, source)` | `get_playlist_detail` | 歌单详情 |
| `ipc.getDailyRecommend(source)` | `get_daily_recommend` | 每日推荐（单音源） |
| `ipc.getPersonalFm(source)` | `get_personal_fm` | 私人 FM（单音源） |
| `ipc.recordPlayEvent(event)` | `record_play_event` | 播放事件上报（静默失败） |
| `ipc.getSmartRecommend()` | `get_smart_recommend` | 智能推荐（重排序） |
| `ipc.getRadioBatch(excludeKeys)` | `get_radio_batch` | 无限电台批量 |
| `ipc.extractCoverColor(url)` | `extract_cover_color` | 封面主色调 |
| `ipc.clientLog(level, message, traceId?)` | `client_log` | 前端日志转发 |

### 事件监听

- `onPlayerState(cb)` - 监听 `player://state`
- `onPlayerProgress(cb)` - 监听 `player://progress`（含 `emittedAtMs` 用于延迟补偿）
- `onPlayerError(cb)` - 监听 `player://error`
- `onPlayerSpectrum(cb)` - 监听 `player://spectrum`
- `onLoginSuccess(cb)` - 监听 `login://success`
- `onLoginTimeout(cb)` - 监听 `login://timeout`

## 关键依赖与配置

- `react` 18 + `react-dom` 18 - UI 框架
- `react-router-dom` 7 - 路由（MemoryRouter）
- `zustand` 5 - 状态管理
- `@tauri-apps/api` 2 + `@tauri-apps/plugin-store` 2 - Tauri IPC 与持久化
- `@tanstack/react-virtual` 3 - 虚拟滚动（大列表性能、沉浸歌词）
- `lucide-react` - 图标库
- `tailwindcss` 3 + `autoprefixer` + `postcss` - 样式
- `vite` 6 + `@vitejs/plugin-react` - 构建工具
- TypeScript strict 模式，路径别名 `@/*` -> `src/*`

## 数据模型

### Zustand Stores

| Store | 文件 | 职责 |
|-------|------|------|
| `usePlayerStore` | `store/playerStore.ts` | 播放状态、当前曲目、队列、播放模式（sequence/repeat-one/shuffle）、最近播放、隐式行为追踪（播放事件上报）、无限电台自动补充 |
| `useUiStore` | `store/uiStore.ts` | 主题（dark/light）、侧边栏折叠状态、沉浸模式开关 |
| `useVisualizerStore` | `store/visualizerStore.ts` | 频谱可视化开关、模式（bars/wave/circle）、粒子效果、颜色预设（5 套）、spectrumDataRef 共享数据 |
| `useToastStore` | `store/toastStore.ts` | Toast 通知队列（最多 3 条，3 秒自动消失） |
| `usePlaylistStore` | `store/playlistStore.ts` | 用户歌单列表 |
| `useFmStore` | `store/fmStore.ts` | FM 电台队列、音源选择、自动预取（队列 < 2 首时拉取更多） |
| `useRecommendStore` | `store/recommendStore.ts` | 智能推荐数据（personalized/topArtists/rediscover）、30s 冷却防重复请求 |

### 行为追踪 (`playerStore.ts`)

- 在 `playFromQueue` 时开始追踪新曲目，`flushPlayEvent()` 上报旧曲目的播放事件
- 累计实际播放时长（排除暂停时间）
- 完成判定：播放 >= 80% 或 >= 时长 - 10s
- 通过 `ipc.recordPlayEvent()` 静默上报（失败不阻塞播放）

### 无限电台 (`playerStore.ts`)

- `autoReplenish()`：队列剩余 <= 2 首时自动调用 `ipc.getRadioBatch()`
- 排除当前队列中已有曲目（key: `source:id`）
- 静默失败，不中断当前播放

### 设置持久化 (`src/lib/settings.ts`)

通过 `tauri-plugin-store` 存储到 `settings.json`，包括：theme、volume、visualizer 配置。

### 动态主题 (`src/hooks/useDynamicTheme.ts`)

从当前播放歌曲的封面图提取平均色，动态设置 CSS 变量 `--accent` 和 `--shadow-glow`。

### 歌单自动刷新 (`src/hooks/usePlaylistAutoRefresh.ts`)

- 启动时立即拉取
- 每 30 分钟定时刷新（仅页面可见时）
- 页面从后台恢复时补偿刷新（store 内 5 分钟节流）

### 错误处理 (`src/lib/errorMessages.ts`)

- `sanitizeError(error)` - 将后端 IpcError 转换为用户友好的中文消息
- 开发环境显示详细错误信息和 traceId，生产环境显示简化消息
- 错误类型映射：network / unauthorized / payment_required / not_found / rate_limited / invalid_input / internal

## 组件结构

```
src/
  App.tsx                          # 根组件，路由、全局事件监听、键盘快捷键、错误日志转发
  main.tsx                         # ReactDOM 挂载点
  index.css                        # 全局样式
  styles/theme.css                 # CSS 变量主题定义
  lib/
    ipc.ts                         # Tauri IPC 封装（含 traceId 生成、自动重试）
    settings.ts                    # 设置持久化
    utils.ts                       # 工具函数（formatTime）
    errorMessages.ts               # 错误消息国际化
  hooks/
    useDynamicTheme.ts             # 动态主题色提取
    useFocusTrap.ts                # 焦点陷阱（模态框无障碍）
    useAutoHide.ts                 # 自动隐藏控件（沉浸模式控制栏 3s 自动隐藏）
    usePlaylistAutoRefresh.ts      # 歌单自动刷新（30 分钟定时 + 可见性补偿）
  store/
    playerStore.ts                 # 播放器状态 + 行为追踪 + 无限电台
    uiStore.ts                     # UI 状态 + 沉浸模式
    visualizerStore.ts             # 可视化状态 + 共享频谱数据
    toastStore.ts                  # Toast 通知
    playlistStore.ts               # 歌单状态
    fmStore.ts                     # FM 电台状态
    recommendStore.ts              # 推荐数据状态
  components/
    layout/
      Sidebar.tsx                  # 侧边栏导航
      PlayerBar.tsx                # 底部播放控制栏
    player/
      LyricsPanel.tsx              # 歌词面板
      QueuePanel.tsx               # 播放队列面板
      PlaybackProgress.tsx         # 播放进度条（RAF 60fps 插值）
      SpectrumVisualizer.tsx       # 小型频谱可视化（底栏内嵌）
      ParticleSystem.tsx           # 粒子效果
      ImmersiveFMPanel.tsx         # 沉浸式播放面板（入口容器）
      ImmersiveBackground.tsx      # 沉浸背景（全屏可视化 25% 不透明度）
      ImmersiveCover.tsx           # 沉浸封面（圆形旋转 / 圆角方形）
      ImmersiveTrackInfo.tsx       # 沉浸曲目信息
      ImmersiveLyrics.tsx          # 沉浸歌词（虚拟滚动 + 二分查找定位）
      ImmersiveControls.tsx        # 沉浸控制栏（自动隐藏）
      FullscreenVisualizer.tsx     # 全屏可视化 Canvas（75% 分辨率、30fps 帧限、批量绘制）
      VizModeSwitcher.tsx          # 可视化模式切换（bars/circle/wave）
      FMControlBar.tsx             # FM 控制栏（不喜欢/上一首/播放/下一首/喜欢）
    common/
      TrackRow.tsx                 # 歌曲行组件
      VirtualTrackList.tsx         # 虚拟滚动歌曲列表
      ContextMenu.tsx              # 右键菜单
      BackButton.tsx               # 返回按钮
      ToastContainer.tsx           # Toast 容器
      ErrorBoundary.tsx            # 错误边界
      CoverImage.tsx               # 封面图片组件
      SourceBadge.tsx              # 音源标识（网易/QQ 彩色小标签）
      HorizontalScroll.tsx         # 水平滚动容器（带左右箭头）
    recommend/
      TrackCard.tsx                # 推荐歌曲卡片（封面 + 标题 + 音源标识）
      ArtistCard.tsx               # 艺术家卡片（首字母头像 + 播放次数）
      SectionSkeleton.tsx          # 推荐区域骨架屏
  views/
    HomeView.tsx                   # 首页
    SearchView.tsx                 # 搜索页
    SettingsView.tsx               # 设置页（懒加载）
    PlaylistDetailView.tsx         # 歌单详情页（懒加载）
    DailyRecommendView.tsx         # 每日推荐页（懒加载）— 三栏布局：为你精选 / 艺术家推荐 / 重温经典
```

### 沉浸模式

- 入口：点击底栏封面或按 Escape 关闭
- 布局：左侧封面+曲目信息+可视化切换，右侧虚拟滚动歌词
- 背景：全屏 Canvas 可视化（25% 不透明度）
- 控制栏：3 秒无操作自动隐藏（鼠标移动/点击时显示），含 FM 控制按钮和进度条
- 封面：circle 模式时旋转动画（`animate-cover-rotate`），播放暂停时动画暂停
- GPU 优化：Canvas 以 75% 分辨率渲染、30fps 帧限、MutationObserver 监听 accent 色变化代替 RAF 内 getComputedStyle

### 键盘快捷键

- `Space` - 播放/暂停
- `ArrowUp/Down` - 音量 +/- 5%
- `ArrowRight/Left` - 快进/快退 5 秒
- `Ctrl+B` - 切换侧边栏
- `Escape` - 退出沉浸模式

### 全局错误捕获

- `window.error` 事件 - 捕获运行时错误，通过 `ipc.clientLog()` 转发到后端日志
- `unhandledrejection` 事件 - 捕获未处理的 Promise 拒绝
- `ErrorBoundary` 组件 - 捕获 React 组件树错误

## 测试与质量

当前无测试文件。建议测试方向：Zustand store 逻辑（尤其 playerStore 的行为追踪和 autoReplenish）、IPC mock 测试（自动重试逻辑）、组件渲染测试。

## 相关文件清单

- `src/App.tsx` - 根组件（273 行）
- `src/main.tsx` - 挂载点
- `src/lib/ipc.ts` - IPC 封装（180 行，含 traceId + 自动重试 + 19 个 IPC 方法 + 6 个事件监听）
- `src/lib/errorMessages.ts` - 错误消息国际化
- `src/lib/settings.ts` - 设置持久化
- `src/store/playerStore.ts` - 播放器 store（283 行，含行为追踪 + 无限电台）
- `src/store/fmStore.ts` - FM 电台 store（77 行）
- `src/store/recommendStore.ts` - 推荐 store（48 行）
- `src/store/visualizerStore.ts` - 可视化 store（70 行，含 spectrumDataRef）
- `src/store/uiStore.ts` - UI store（25 行，含 immersiveOpen）
- `src/components/player/FullscreenVisualizer.tsx` - 全屏可视化（301 行，3 种模式 + 粒子系统）
- `src/components/player/ImmersiveFMPanel.tsx` - 沉浸模式容器（80 行）
- `src/components/player/ImmersiveLyrics.tsx` - 沉浸歌词（162 行，虚拟滚动 + 二分查找）
- `src/components/player/PlaybackProgress.tsx` - 播放进度条（186 行，RAF 60fps 本地插值）
- `src/views/DailyRecommendView.tsx` - 每日推荐页（267 行）
- `src/hooks/useDynamicTheme.ts` - 动态主题
- `src/hooks/useAutoHide.ts` - 自动隐藏（21 行）
- `src/hooks/usePlaylistAutoRefresh.ts` - 歌单自动刷新（45 行）
- `package.json` - 依赖配置
- `vite.config.ts` - Vite 配置
- `tsconfig.json` - TypeScript 配置
