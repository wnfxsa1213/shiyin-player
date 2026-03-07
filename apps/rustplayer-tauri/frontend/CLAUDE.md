[根目录](../../../CLAUDE.md) > [apps](../../) > [rustplayer-tauri](../) > **frontend**

# apps/rustplayer-tauri/frontend - React 前端

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-02-27T16:32:02 | 增量更新 | 新增 traceId 自动生成、错误消息国际化、前端日志转发、登录事件监听 |
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |

## 模块职责

Tauri 应用的前端 UI 层。基于 React 18 + TypeScript + Tailwind CSS 构建，提供搜索、播放控制、歌词显示、频谱可视化、歌单管理、设置等完整用户界面。

## 入口与启动

- 入口文件：`src/main.tsx` -> `src/App.tsx`
- Vite dev server 端口：1420
- 路由：MemoryRouter（Home / Search / Settings / PlaylistDetail）

## 对外接口

### IPC 封装 (`src/lib/ipc.ts`)

所有与 Rust 后端的通信集中在此文件，每次调用自动生成 traceId：
- `ipc.searchMusic(query, source?)` - 搜索
- `ipc.playTrack(track)` - 播放
- `ipc.togglePlayback()` - 播放/暂停
- `ipc.seek(positionMs)` - 跳转
- `ipc.setVolume(volume)` - 音量
- `ipc.getLyrics(trackId, source)` - 歌词
- `ipc.login(source, cookie)` / `ipc.logout(source)` - 认证
- `ipc.openLoginWindow(source)` - 打开 WebView 登录窗口
- `ipc.checkLoginStatus()` - 检查登录状态
- `ipc.getUserPlaylists(source?)` / `ipc.getPlaylistDetail(id, source)` - 歌单
- `ipc.extractCoverColor(url)` - 提取封面主色调（HSL）
- `ipc.clientLog(level, message, traceId?)` - 前端日志转发到后端

### 事件监听

- `onPlayerState(cb)` - 监听 `player://state`
- `onPlayerProgress(cb)` - 监听 `player://progress`
- `onPlayerError(cb)` - 监听 `player://error`
- `onPlayerSpectrum(cb)` - 监听 `player://spectrum`
- `onLoginSuccess(cb)` - 监听 `login://success`
- `onLoginTimeout(cb)` - 监听 `login://timeout`

## 关键依赖与配置

- `react` 18 + `react-dom` 18 - UI 框架
- `react-router-dom` 7 - 路由（MemoryRouter）
- `zustand` 5 - 状态管理
- `@tauri-apps/api` 2 + `@tauri-apps/plugin-store` 2 - Tauri IPC 与持久化
- `@tanstack/react-virtual` 3 - 虚拟滚动（大列表性能）
- `lucide-react` - 图标库
- `tailwindcss` 3 + `autoprefixer` + `postcss` - 样式
- `vite` 6 + `@vitejs/plugin-react` - 构建工具
- TypeScript strict 模式，路径别名 `@/*` -> `src/*`

## 数据模型

### Zustand Stores

| Store | 文件 | 职责 |
|-------|------|------|
| `usePlayerStore` | `store/playerStore.ts` | 播放状态、当前曲目、队列、播放模式（sequence/repeat-one/shuffle）、最近播放 |
| `useUiStore` | `store/uiStore.ts` | 主题（dark/light）、侧边栏折叠状态 |
| `useVisualizerStore` | `store/visualizerStore.ts` | 频谱可视化开关、模式（bars/wave/circle）、粒子效果、颜色预设 |
| `useToastStore` | `store/toastStore.ts` | Toast 通知队列（最多 3 条，3 秒自动消失） |
| `usePlaylistStore` | `store/playlistStore.ts` | 用户歌单列表 |

### 设置持久化 (`src/lib/settings.ts`)

通过 `tauri-plugin-store` 存储到 `settings.json`，包括：theme、volume、visualizer 配置。

### 动态主题 (`src/hooks/useDynamicTheme.ts`)

从当前播放歌曲的封面图提取平均色，动态设置 CSS 变量 `--accent` 和 `--shadow-glow`。

### 错误处理 (`src/lib/errorMessages.ts`)

- `sanitizeError(error)` - 将后端 IpcError 转换为用户友好的中文消息
- 开发环境显示详细错误信息和 traceId，生产环境显示简化消息
- 错误类型映射：network / unauthorized / not_found / rate_limited / invalid_input / internal

## 组件结构

```
src/
  App.tsx                          # 根组件，路由、全局事件监听、键盘快捷键、错误日志转发
  main.tsx                         # ReactDOM 挂载点
  index.css                        # 全局样式
  styles/theme.css                 # CSS 变量主题定义
  lib/
    ipc.ts                         # Tauri IPC 封装（125 行，含 traceId 生成）
    settings.ts                    # 设置持久化
    utils.ts                       # 工具函数（formatTime）
    errorMessages.ts               # 错误消息国际化（55 行）
  hooks/
    useDynamicTheme.ts             # 动态主题色提取
    useFocusTrap.ts                # 焦点陷阱（模态框无障碍）
  store/
    playerStore.ts                 # 播放器状态
    uiStore.ts                     # UI 状态
    visualizerStore.ts             # 可视化状态
    toastStore.ts                  # Toast 通知
    playlistStore.ts               # 歌单状态
  components/
    layout/
      Sidebar.tsx                  # 侧边栏导航
      PlayerBar.tsx                # 底部播放控制栏
    player/
      LyricsPanel.tsx              # 歌词面板
      QueuePanel.tsx               # 播放队列面板
      PlaybackProgress.tsx         # 播放进度条
      SpectrumVisualizer.tsx       # 频谱可视化
      ParticleSystem.tsx           # 粒子效果
    common/
      TrackRow.tsx                 # 歌曲行组件
      VirtualTrackList.tsx         # 虚拟滚动歌曲列表
      ContextMenu.tsx              # 右键菜单
      BackButton.tsx               # 返回按钮
      ToastContainer.tsx           # Toast 容器
      ErrorBoundary.tsx            # 错误边界
      CoverImage.tsx               # 封面图片组件
  views/
    HomeView.tsx                   # 首页
    SearchView.tsx                 # 搜索页
    SettingsView.tsx               # 设置页
    PlaylistDetailView.tsx         # 歌单详情页
```

### 键盘快捷键

- `Space` - 播放/暂停
- `ArrowUp/Down` - 音量 +/- 5%
- `ArrowRight/Left` - 快进/快退 5 秒
- `Ctrl+B` - 切换侧边栏

### 全局错误捕获

- `window.error` 事件 - 捕获运行时错误，通过 `ipc.clientLog()` 转发到后端日志
- `unhandledrejection` 事件 - 捕获未处理的 Promise 拒绝
- `ErrorBoundary` 组件 - 捕获 React 组件树错误

## 测试与质量

当前无测试文件。建议测试方向：Zustand store 逻辑、IPC mock 测试、组件渲染测试。

## 相关文件清单

- `src/App.tsx` - 根组件（194 行）
- `src/main.tsx` - 挂载点（11 行）
- `src/lib/ipc.ts` - IPC 封装（125 行）
- `src/lib/errorMessages.ts` - 错误消息国际化（55 行）
- `src/lib/settings.ts` - 设置持久化（23 行）
- `src/store/playerStore.ts` - 播放器 store（170 行）
- `src/store/visualizerStore.ts` - 可视化 store（67 行）
- `src/hooks/useDynamicTheme.ts` - 动态主题（~50 行）
- `package.json` - 依赖配置
- `vite.config.ts` - Vite 配置
- `tsconfig.json` - TypeScript 配置
