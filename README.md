# RustPlayer 🎵

基于 Rust + Tauri v2 的跨平台桌面音乐播放器，支持网易云音乐和 QQ 音乐双平台聚合搜索与播放。

## 功能特性

- 聚合搜索：同时搜索网易云音乐和 QQ 音乐
- 在线播放：基于 GStreamer 的高质量音频播放引擎
- 歌词同步：逐行歌词滚动 + 翻译显示
- 复古未来主义 UI：霓虹灯光效、CRT 扫描线、赛博朋克风格
- 键盘快捷键：空格播放/暂停、方向键调节音量和进度
- Cookie 登录：支持网易云/QQ 音乐 Cookie 登录获取高级权限
- 搜索缓存：LRU + TTL 缓存策略，减少重复请求
- 明暗主题切换

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri v2 |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 后端 | Rust (Cargo Workspace) |
| 音频 | GStreamer 0.23 |
| 状态管理 | Zustand |
| 加密 | AES-128-CBC + RSA (网易 weapi) / MD5 签名 (QQ) |

## 项目结构

```
rust-music/
├── apps/rustplayer-tauri/
│   ├── frontend/          # React 前端
│   │   ├── src/
│   │   │   ├── components/  # UI 组件
│   │   │   ├── views/       # 页面视图
│   │   │   ├── store/       # Zustand 状态
│   │   │   ├── lib/         # IPC 封装 + 工具函数
│   │   │   └── styles/      # 主题样式
│   │   └── package.json
│   └── src-tauri/         # Rust 后端
│       └── src/
│           ├── main.rs      # 应用入口
│           ├── commands/    # Tauri IPC 命令
│           └── events.rs    # 后端→前端事件转发
├── crates/
│   ├── core/              # 核心类型定义
│   ├── player/            # GStreamer 播放引擎
│   ├── sources/           # 音源注册中心
│   ├── netease/           # 网易云音乐 API
│   ├── qqmusic/           # QQ 音乐 API
│   └── cache/             # LRU 搜索缓存
└── Cargo.toml             # Workspace 配置
```

## 环境要求

- Rust 1.75+
- Node.js 18+
- GStreamer 1.20+ 开发库
- Tauri v2 CLI

### Linux (Ubuntu/Debian)

```bash
# 系统依赖
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
sudo apt install libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly

# Tauri CLI
cargo install tauri-cli --version "^2"
```

## 构建与运行

```bash
# 开发模式
cd apps/rustplayer-tauri/frontend && npm install && cd -
cargo tauri dev

# 生产构建
cargo tauri build

# 二进制文件位于
./target/release/rustplayer-tauri
```

## 日志与调试

- 后端日志：使用 `tracing` 落盘到“应用数据目录”的 `logs/` 下，按天滚动，文件名形如 `rustplayer-backend.jsonl.YYYY-MM-DD`
- 前端错误：`window.error` / `unhandledrejection` / React ErrorBoundary 会 best-effort 转存到后端日志（便于 release 环境排查）
- 详细度控制：通过 `RUST_LOG` 调整，例如：

```bash
RUST_LOG=debug cargo tauri dev
```

- 端到端排查：每次 IPC 调用会生成并传递 `traceId`（开发模式下 toast 会附带 traceId），在日志里直接按 traceId 搜索即可定位整条链路

## 快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 播放 / 暂停 |
| `↑` / `↓` | 音量增减 |
| `←` / `→` | 快退 / 快进 5 秒 |

## 许可证

MIT
