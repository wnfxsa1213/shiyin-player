# 📋 实施计划：RustPlayer — Linux Rust 音乐播放器

## 任务类型
- [x] 前端 (→ Gemini)
- [x] 后端 (→ Codex)
- [x] 全栈 (→ 并行)

## 需求概述

构建一个 Linux 桌面端 GUI 音乐播放器，使用 Rust 开发，支持网易云音乐和 QQ 音乐源，具备 Spotify 风格的现代界面。

## 技术方案

### 技术栈选型（综合 Codex + Gemini 分析）

| 层级 | 技术选型 | 理由 |
|------|----------|------|
| UI 框架 | **Tauri v2** | Spotify 风格 UI 需要高度自定义，Web 技术（CSS/JS）远优于 GTK 原生控件 |
| 前端 | **React 18 + TypeScript + Vite + Tailwind CSS** | 生态成熟，组件丰富，虚拟滚动/动画支持好 |
| 状态管理 | **Zustand** | 轻量，支持 Tauri 事件监听器在 React 外部更新状态 |
| 音频引擎 | **gstreamer-rs** | Linux 音频生态最成熟，MP3/AAC/FLAC 流式播放支持完整 |
| 异步运行时 | **tokio** | Rust 异步标准，处理网络请求和后台任务 |
| HTTP 客户端 | **reqwest** | 异步 HTTP，支持 cookie jar、超时、重试 |
| 加密 | **aes + rsa crate** | 网易云 weapi 加密所需 |
| 持久化 | **tauri-plugin-store** + **SQLite (rusqlite)** | 配置 + 缓存 |

### 系统依赖（需安装）

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \
  libasound2-dev libssl-dev pkg-config
```

## 项目结构

```
rustplayer/
├── Cargo.toml                    # Workspace root
├── apps/
│   └── rustplayer-tauri/
│       ├── Cargo.toml            # Tauri app crate
│       ├── src/
│       │   ├── main.rs           # Tauri 入口
│       │   ├── commands/         # IPC command handlers
│       │   │   ├── mod.rs
│       │   │   ├── player.rs     # play, pause, seek, volume
│       │   │   ├── search.rs     # search across sources
│       │   │   └── auth.rs       # login/logout
│       │   └── events.rs         # Backend → Frontend 事件发射
│       ├── tauri.conf.json
│       └── frontend/             # React 前端
│           ├── package.json
│           ├── vite.config.ts
│           ├── src/
│           │   ├── App.tsx
│           │   ├── main.tsx
│           │   ├── store/
│           │   │   ├── playerStore.ts
│           │   │   └── uiStore.ts
│           │   ├── lib/
│           │   │   └── ipc.ts    # Tauri IPC 封装
│           │   ├── components/
│           │   │   ├── layout/   # Sidebar, PlayerBar, AppShell
│           │   │   ├── common/   # TrackRow, AlbumCard, SearchInput
│           │   │   └── player/   # Controls, SeekBar, VolumeSlider, Lyrics
│           │   ├── views/        # Home, Search, PlaylistDetail, Settings
│           │   └── styles/
│           │       └── theme.css # CSS 变量 (Dark/Light)
│           └── tailwind.config.ts
├── crates/
│   ├── core/                     # 通用类型、错误、事件定义
│   │   └── src/lib.rs
│   ├── player/                   # gstreamer 播放引擎
│   │   └── src/lib.rs
│   ├── sources/                  # MusicSource trait + 注册表
│   │   └── src/lib.rs
│   ├── netease/                  # 网易云音乐 API 客户端
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── crypto.rs         # weapi 加密
│   │       └── api.rs            # 端点实现
│   └── qqmusic/                  # QQ 音乐 API 客户端
│       └── src/
│           ├── lib.rs
│           ├── sign.rs           # 签名计算
│           └── api.rs            # 端点实现
└── docs/
```

## 核心接口设计

### MusicSource Trait（插件化音乐源）

```rust
#[async_trait::async_trait]
pub trait MusicSource: Send + Sync {
    fn id(&self) -> &str;                    // "netease" | "qqmusic"
    fn name(&self) -> &str;                  // 显示名称
    async fn search(&self, query: &str, page: u32) -> Result<Vec<Track>, SourceError>;
    async fn get_stream_url(&self, track_id: &str) -> Result<StreamInfo, SourceError>;
    async fn get_lyrics(&self, track_id: &str) -> Result<Vec<LyricsLine>, SourceError>;
    async fn get_album_art(&self, track_id: &str) -> Result<Option<String>, SourceError>;
    async fn login(&self, credentials: Credentials) -> Result<AuthToken, SourceError>;
}
```

### Player 状态机

```
Idle → Loading → Playing ⇄ Paused → Stopped
                    ↓                    ↑
                  Error ─────────────────┘
```

```rust
pub enum PlayerState {
    Idle,
    Loading { track: Track },
    Playing { track: Track, position_ms: u64 },
    Paused  { track: Track, position_ms: u64 },
    Stopped,
}

pub enum PlayerCommand {
    Load(Track, StreamInfo),
    Play, Pause, Stop,
    Seek(u64),          // position_ms
    SetVolume(f32),     // 0.0 ~ 1.0
}

pub enum PlayerEvent {
    StateChanged(PlayerState),
    Progress { position_ms: u64, duration_ms: u64 },
    Error(PlayerError),
}
```

### GStreamer 音频管线

```
uridecodebin(url) → audioconvert → audioresample → volume → autoaudiosink
```

### Tauri IPC 接口

| Command | 方向 | 说明 |
|---------|------|------|
| `search_music(query, source?)` | FE→BE | 搜索歌曲 |
| `play_track(track_id, source)` | FE→BE | 播放指定歌曲 |
| `toggle_playback()` | FE→BE | 播放/暂停切换 |
| `seek(position_ms)` | FE→BE | 跳转进度 |
| `set_volume(volume)` | FE→BE | 设置音量 |
| `get_lyrics(track_id, source)` | FE→BE | 获取歌词 |
| `login(source, credentials)` | FE→BE | 登录音乐源 |
| `player://state` | BE→FE | 播放状态变更事件 |
| `player://progress` | BE→FE | 进度更新（500ms 间隔）|
| `player://error` | BE→FE | 错误通知 |

## 实施步骤

### Step 1：项目脚手架搭建
- 初始化 Cargo workspace
- `cargo create-tauri-app` 创建 Tauri v2 项目
- 创建 `crates/core`、`crates/player`、`crates/sources`、`crates/netease`、`crates/qqmusic`
- 前端初始化：React + Vite + Tailwind + Zustand
- 预期产物：可编译运行的空壳应用

### Step 2：Core 类型定义
- 定义 `Track`、`StreamInfo`、`LyricsLine`、`PlayerState`、`PlayerCommand`、`PlayerEvent`
- 定义 `MusicSource` trait
- 定义统一错误类型 `AppError`、`SourceError`、`PlayerError`
- 预期产物：`crates/core/src/lib.rs` 完整类型系统

### Step 3：GStreamer 播放引擎
- 实现 `Player` struct，封装 gstreamer pipeline
- 状态机：Idle → Loading → Playing ⇄ Paused → Stopped
- 支持：play、pause、stop、seek、set_volume
- 500ms 定时器报告播放进度
- 错误处理：网络中断、解码失败 → PlayerError
- 预期产物：`crates/player/src/lib.rs`

### Step 4：网易云音乐 API 客户端
- 实现 weapi 加密（AES-128-CBC + RSA）
- 实现端点：search、song_detail、song_url、lyrics、playlist
- Cookie 认证管理
- 请求超时 5s，失败重试 1 次，429 退避
- 预期产物：`crates/netease/src/`

### Step 5：QQ 音乐 API 客户端
- 实现签名计算（Signer trait）
- 实现端点：search、song_detail、song_url（vkey 机制）、lyrics
- GUID 管理与 vkey 刷新
- 预期产物：`crates/qqmusic/src/`

### Step 6：Tauri IPC 层
- 注册 Tauri commands：search、play_track、toggle、seek、volume、login
- 实现事件发射：player://state、player://progress、player://error
- 统一错误响应格式：`{ code, message, retryable }`
- 预期产物：`apps/rustplayer-tauri/src/commands/` + `events.rs`

### Step 7：前端 UI 框架
- AppShell 三栏布局（Sidebar + MainContent + PlayerBar）
- React Router (MemoryRouter) 路由：Home、Search、PlaylistDetail、Settings
- Zustand stores：playerStore（全局播放状态）、uiStore（UI 状态）
- Tauri 事件监听器初始化（ipc.ts）
- 预期产物：前端骨架可运行

### Step 8：前端核心组件
- Sidebar：导航链接 + 用户歌单列表
- PlayerBar：当前曲目信息 + 播放控制 + 进度条（Radix Slider）+ 音量
- SearchView：搜索输入（300ms debounce）+ 分 Tab 结果（网易云/QQ）
- TrackRow：可复用歌曲行组件（hover 显示播放按钮）
- PlaylistDetail：虚拟滚动（@tanstack/react-virtual）
- 预期产物：完整可交互 UI

### Step 9：主题与交互
- CSS 变量 Dark/Light 主题（`data-theme` 属性切换）
- 键盘快捷键：Space=播放暂停、方向键=音量/切歌
- 右键上下文菜单（Radix ContextMenu）
- 歌词面板（同步滚动）
- 预期产物：完整用户体验

### Step 10：缓存与持久化
- 内存 LRU 缓存：搜索结果、歌曲详情
- SQLite 缓存：track metadata、歌词
- tauri-plugin-store：用户设置、主题偏好
- Cookie 加密存储
- 预期产物：离线友好体验

## 关键文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `Cargo.toml` | 新建 | Workspace 根配置 |
| `crates/core/src/lib.rs` | 新建 | Track, MusicSource trait, 错误类型 |
| `crates/player/src/lib.rs` | 新建 | GStreamer 播放引擎 + 状态机 |
| `crates/netease/src/crypto.rs` | 新建 | weapi AES+RSA 加密 |
| `crates/netease/src/api.rs` | 新建 | 网易云 API 端点实现 |
| `crates/qqmusic/src/sign.rs` | 新建 | QQ 音乐签名计算 |
| `crates/qqmusic/src/api.rs` | 新建 | QQ 音乐 API 端点实现 |
| `apps/rustplayer-tauri/src/main.rs` | 新建 | Tauri 入口 + command 注册 |
| `apps/rustplayer-tauri/src/commands/` | 新建 | IPC handlers |
| `frontend/src/App.tsx` | 新建 | 三栏布局 + 路由 |
| `frontend/src/store/playerStore.ts` | 新建 | 播放状态管理 |
| `frontend/src/lib/ipc.ts` | 新建 | Tauri IPC 封装层 |
| `frontend/src/components/layout/` | 新建 | Sidebar, PlayerBar |
| `frontend/src/views/` | 新建 | Home, Search, PlaylistDetail, Settings |

## 风险与缓解

| 风险 | 严重度 | 缓解措施 |
|------|--------|----------|
| 网易云/QQ API 变更或加密算法更新 | 高 | MusicSource trait 插件化隔离；版本化加密模块；社区跟踪 |
| 反爬风控（IP 封禁、验证码） | 高 | 请求限流（1 req/s）；Cookie 持久化；降级提示用户 |
| GStreamer 与 tokio 主循环冲突 | 中 | 播放器独立线程，通过 channel 与 tokio 通信 |
| 版权/法律风险 | 中 | 仅供个人学习使用；不缓存音频文件；不提供下载功能 |
| WebKitGTK 渲染性能 | 低 | 虚拟滚动；懒加载图片；节流进度更新 |
| 前端构建链依赖 Node.js | 低 | Tauri CLI 内置前端构建；仅开发时需要 Node |

## 数据流

### 搜索流程
```
用户输入 → debounce(300ms) → IPC search_music → tokio spawn →
  MusicSource.search(netease) ─┐
  MusicSource.search(qqmusic) ─┤→ 合并结果 → IPC 返回 → Zustand → UI 渲染
```

### 播放流程
```
用户点击播放 → IPC play_track → get_stream_url → Player.load(url) →
  GStreamer pipeline 构建 → State=Loading → State=Playing →
  每 500ms emit progress → IPC event → Zustand.updateProgress → SeekBar 更新
```

### 错误处理流程
```
HTTP 错误 → SourceError → AppError { code, message, retryable } → IPC event → Toast 通知
Pipeline 错误 → PlayerError → State=Stopped → IPC event → UI 重置播放栏
```

## 测试策略

| 层级 | 方法 | 覆盖范围 |
|------|------|----------|
| 单元测试 | `#[cfg(test)]` | weapi 加密、签名计算、状态机转移 |
| 集成测试 | wiremock mock server | HTTP 请求格式、错误处理、重试逻辑 |
| E2E 测试 | Tauri test utils | IPC command → mock source → 事件契约 |
| 前端测试 | Vitest + Testing Library | 组件渲染、store 更新、IPC mock |

## SESSION_ID（供 /ccg:execute 使用）

- CODEX_SESSION: 019c8d23-7d12-7e60-b495-e9d80de2ccf0
- GEMINI_SESSION: 3d00f967-da5c-45e9-a9b6-5a148f8cd343
