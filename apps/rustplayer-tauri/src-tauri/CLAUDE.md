[根目录](../../../../CLAUDE.md) > [apps](../../) > [rustplayer-tauri](../) > **src-tauri**

# apps/rustplayer-tauri/src-tauri - Tauri 应用后端

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-02-27T16:32:02 | 增量更新 | 新增 traceId 链路追踪、结构化日志、WebView 登录窗口、封面色提取、前端日志接收 |
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |

## 模块职责

Tauri v2 桌面应用的 Rust 后端入口。负责初始化播放引擎、注册音源、暴露 IPC commands、转发播放器事件到前端、管理 SQLite 持久缓存和 Cookie 存储、结构化日志系统。

## 入口与启动

- 入口文件：`src/main.rs`
- 启动流程：
  1. 初始化日志系统（tracing + JSON Lines 落盘）
  2. 初始化 `Player`（GStreamer 引擎）
  3. 创建 `SourceRegistry`，注册 NeteaseClient + QqMusicClient
  4. 创建内存 `SearchCache`
  5. 创建 reqwest HTTP 客户端（用于封面图下载）
  6. 构建 Tauri app，注册 plugins（shell, store）和 commands
  7. setup 阶段：启动事件转发、打开 SQLite 数据库、恢复已保存的 Cookie、启动定时缓存清理

## 对外接口

### Tauri Commands (IPC)

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `search_music` | query, source?, trace_id? | `Vec<Track>` | 三级缓存搜索（L1 内存 -> L2 SQLite -> L3 API），并发查询多音源 |
| `play_track` | track, trace_id? | `()` | 获取流 URL 并加载到播放器 |
| `toggle_playback` | trace_id? | `()` | 播放/暂停切换 |
| `seek` | position_ms, trace_id? | `()` | 跳转播放进度 |
| `set_volume` | volume (0.0-1.0), trace_id? | `()` | 设置音量 |
| `get_lyrics` | track_id, source, trace_id? | `Vec<LyricsLine>` | 获取歌词（SQLite 缓存优先） |
| `login` | source, credentials, trace_id? | `AuthToken` | 登录并持久化 Cookie |
| `logout` | source, trace_id? | `()` | 删除已保存的 Cookie |
| `open_login_window` | source, trace_id? | `()` | 打开 WebView 登录窗口，自动提取 Cookie |
| `check_login_status` | trace_id? | `HashMap<MusicSourceId, bool>` | 检查所有音源登录状态 |
| `get_user_playlists` | source?, trace_id? | `Vec<PlaylistBrief>` | 获取用户歌单，并发查询多音源 |
| `get_playlist_detail` | id, source, trace_id? | `Playlist` | 获取歌单详情 |
| `extract_cover_color` | url, trace_id? | `[f64; 3]` | 提取封面主色调（HSL），域名白名单校验 |
| `client_log` | level, message, trace_id? | `()` | 接收前端日志，限流 60 条/分钟 |

### Tauri Events (Backend -> Frontend)

| Event | Payload | 说明 |
|-------|---------|------|
| `player://state` | state label string | 播放状态变更 |
| `player://progress` | { positionMs, durationMs, emittedAtMs } | 播放进度（~5Hz，前端 RAF 60fps 插值） |
| `player://spectrum` | { magnitudes: number[] } | 频谱数据（~15fps） |
| `player://error` | error string | 播放错误 |
| `login://success` | MusicSourceId | 登录成功 |
| `login://timeout` | MusicSourceId | 登录超时 |

## 关键依赖与配置

- `tauri` 2 + `tauri-plugin-shell` + `tauri-plugin-store` - 桌面框架
- `rusqlite` 0.31 (bundled) + `r2d2` + `r2d2_sqlite` - SQLite 持久缓存
- `reqwest` 0.12 (rustls-tls) - HTTP 客户端（封面下载）
- `image` 0.25 (jpeg, png, webp) - 图像处理（封面色提取）
- `tracing` + `tracing-subscriber` + `tracing-appender` - 结构化日志
- `webkit2gtk` 2.0.2 (Linux) + `gio` + `glib` + `soup3` - WebView Cookie 提取
- 所有 6 个内部 crate（core, player, sources, netease, qqmusic, cache）

### 应用配置 (`tauri.conf.json`)

- 产品名：拾音
- 标识符：`com.shiyin.music`
- 窗口：1200x800，最小 900x600
- 前端 dev server：`http://localhost:1420`

## 数据模型

### SQLite 数据库 (`db.rs`)

- 数据库路径：`{app_data_dir}/rustplayer.db`
- `tracks` 表：搜索结果缓存，7 天 TTL，主键 (id, source, search_keyword)
- `lyrics` 表：歌词缓存，7 天 TTL，主键 (track_id, source)
- 自动清理过期条目（每小时定时任务 + 每次查询时限量删除）

### Cookie 存储 (`store.rs`)

- 存储文件：`credentials.json`（通过 tauri-plugin-store）
- 键格式：`cookie_netease` / `cookie_qqmusic`
- 启动时自动恢复 Cookie 并调用各音源的 login

### 日志系统 (`logging.rs`)

- 日志目录：`{app_data_dir}/logs/`
- 文件名：`rustplayer-backend.jsonl.YYYY-MM-DD`
- 格式：JSON Lines（每行一个 JSON 对象）
- 保留策略：7 天自动清理
- 控制台输出：带颜色的紧凑格式
- 文件输出：JSON 格式，包含 span 信息和 traceId

### TraceId 生成 (`trace_ctx.rs`)

- 格式：`{timestamp_hex}-{seq_hex}`（例如：`18f3c8f3b2a-2a`）
- 前端未提供时自动生成
- 所有 IPC command 通过 `run_with_trace()` 包装，自动记录 traceId

### IPC 错误类型 (`commands/mod.rs`)

```rust
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum IpcError {
    Network(String),
    Unauthorized(String),
    NotFound(String),
    RateLimited(String),
    InvalidInput(String),
    Internal(String),
}
```

### WebView 登录窗口 (`commands/mod.rs::open_login_window`)

- Linux 平台：使用 webkit2gtk CookieManager API 提取 HttpOnly Cookie
- 双重检测策略：
  1. JS 注入检测 DOM 元素（用户头像、用户链接）
  2. Cookie 轮询检测关键认证 Cookie（MUSIC_U / qqmusic_key）
- 超时：5 分钟
- 自动验证：提取 Cookie 后立即调用 login 验证有效性

### 封面色提取 (`commands/mod.rs::extract_cover_color`)

- 域名白名单：music.126.net、y.gtimg.cn、imgcache.qq.com 等
- 大小限制：5MB
- 算法：缩放到 20x20，HSL 色相分桶（12 桶），选择饱和度最高的桶
- 返回：HSL 数组 `[h, s, l]`（h: 0-360, s/l: 0-100）

## 测试与质量

当前无测试文件。

## 相关文件清单

- `src/main.rs` - 应用入口与初始化（153 行）
- `src/commands/mod.rs` - IPC command handlers（1024 行）
- `src/events.rs` - 播放器事件转发到前端（56 行）
- `src/db.rs` - SQLite 持久缓存（154 行）
- `src/store.rs` - Cookie 持久化存储（40 行）
- `src/logging.rs` - 日志系统初始化（89 行）
- `src/trace_ctx.rs` - TraceId 生成与 span 创建（24 行）
- `build.rs` - Tauri 构建脚本
- `tauri.conf.json` - Tauri 应用配置
- `capabilities/default.json` - Tauri 权限配置
