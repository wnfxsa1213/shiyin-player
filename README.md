# ShiYin Player（拾音）

基于 **Rust + Tauri v2** 的 Linux 桌面音乐播放器，支持网易云音乐与 QQ 音乐聚合搜索、在线播放、同步歌词、本地个性化推荐，以及可保存和轮换的视觉场景。

A Linux desktop music player built with Rust and Tauri v2, with dual-source search, synchronized lyrics, personalized discovery, and customizable visual scenes.

[下载最新版本](https://github.com/wnfxsa1213/shiyin-player/releases/latest) · [v0.2.0 更新说明](docs/releases/v0.2.0.md) · [开发路线](docs/roadmap.md) · [测试说明](TESTING.md)

## v0.2.0 更新

- 新增八套视觉场景、自定义背景、搭配保存和自适应随机轮换。
- 统一主界面与沉浸播放的队列操作、播放状态和失败恢复。
- 完善推荐聚合、空结果与音源失败反馈。
- 修复沉浸预览在未播放或暂停时停止动画的问题；预览保留正式沉浸的歌词布局与遮罩。

## 功能特性

- **聚合搜索**：同时搜索网易云音乐和 QQ 音乐，使用内存、SQLite 和音源 API 三级缓存。
- **播放与队列**：GStreamer 音频引擎；支持列表循环、单曲循环和随机播放。单曲播放保留队列，播放全部明确替换，指定下一首优先执行。
- **播放恢复**：加载、缓冲、暂停和重试状态持续可见；失败后可重试对应歌曲，加载期间也可保持暂停意图。
- **同步歌词**：逐行显示与滚动，支持翻译歌词。
- **视觉场景**：星海、雨夜、初雪、萤火、流星、气泡、花信、共振八种特效，响应音乐强弱与低频变化。
- **自定义背景**：导入 JPEG、PNG、WebP，或使用当前专辑封面；图片存入应用素材库，移动原文件后仍可使用。
- **搭配与轮换**：先预览再应用，可另存搭配、独立选择轮换成员、锁定场景或手动换一个。
- **沉浸播放**：在窗口内展开封面、歌词和播放控制，与主界面共享队列和视觉场景。
- **音乐发现**：聚合每日推荐，结合实际收听行为进行本地排序，展示偏好艺术家与重温经典；队列接近末尾时可自动补充电台候选。
- **登录与歌单**：支持 WebView 扫码登录、手动 Cookie 登录，以及读取和播放用户歌单。
- **主题与键盘**：深浅主题、封面动态主题色、队列定位、歌曲菜单和键盘操作；尊重减少动态效果偏好。
- **诊断与持久化**：结构化日志、traceId 链路追踪、设置持久化，以及搜索和歌词缓存。

## 开发分支进展（尚未发布）

首页、导航与搜索反馈迭代已实现：

- 首页按“继续收听、我的歌单、智能推荐”组织内容；歌单入口浏览整个集合，推荐读取真实智能推荐结果。
- 首页与侧栏统一使用“播放详情”，打开当前播放的封面、歌词与视觉场景。
- 搜索区分输入前、加载、成功、无结果与失败，支持常驻错误、手动重试和带关键词/音源标记的上次结果；支持中文输入法与 Enter 提交。

页面方案、适用范围与验证见 [首页、导航与搜索反馈](docs/design/home-navigation-search.md)。这些变更位于 `codex/home-navigation-search`，不属于上方 `v0.2.0` 安装包。

## 安装

在 [Releases](https://github.com/wnfxsa1213/shiyin-player/releases) 下载 Linux x86_64 安装包。

Ubuntu / Debian：

```bash
sudo apt install ./ShiYin_0.2.0_amd64.deb
```

AppImage：

```bash
chmod +x ShiYin_0.2.0_amd64.AppImage
./ShiYin_0.2.0_amd64.AppImage
```

在线曲目可用性取决于音乐平台、登录状态和账号权限。

## 界面预览

播放栏与队列（示例曲目）：

![播放栏与队列](docs/design/assets/playback-ui-1200-dark.png)

沉浸场景预览与歌词（示例曲目）：

![沉浸场景预览](docs/design/assets/ui-review-preview-1200-dark.png)

开发分支首页（隔离验收中的示例数据）：

![首页](docs/design/assets/home-navigation-1200-dark.png)

搜索失败与上次结果（最小窗口、浅色主题）：

![搜索反馈](docs/design/assets/search-feedback-900-light.png)

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | Tauri v2 |
| 前端 | React 18、TypeScript、Tailwind CSS、Zustand |
| 后端 | Rust workspace：7 个业务 crate + 1 个 Tauri 应用 |
| 音频 | GStreamer（gstreamer-rs） |
| 视觉场景 | Canvas2D、共享调度、自动质量调整 |
| 长列表 | @tanstack/react-virtual |
| 持久化 | tauri-plugin-store、SQLite（rusqlite + r2d2） |
| 验证 | Vitest、Testing Library、Rust 测试、Chromium / WebKitGTK 功能验收 |

## 项目结构

```text
shiyin-player/
├── apps/rustplayer-tauri/
│   ├── frontend/src/
│   │   ├── components/       # 播放、布局、推荐、视觉场景组件
│   │   ├── views/            # 首页、搜索、歌单、推荐、场景库、设置
│   │   ├── store/            # 生产依赖与状态装配
│   │   └── lib/              # IPC、播放生命周期、场景状态/调度/渲染
│   └── src-tauri/src/        # IPC 命令、事件、数据库、背景素材与日志
├── crates/
│   ├── core/                # 共享类型与音源接口
│   ├── player/              # GStreamer 播放引擎
│   ├── sources/             # 音源注册中心
│   ├── netease/             # 网易云音乐客户端
│   ├── qqmusic/             # QQ 音乐客户端
│   ├── cache/               # 内存搜索缓存
│   └── recommend/           # 本地推荐引擎
├── docs/                    # 设计、评审、验证与发布记录
└── scripts/scene-stress/     # 独立压力测试工具
```

## 开发环境

- Rust stable（本轮本地验证使用 1.98.1）。
- Node.js 20+、npm。
- GStreamer 1.20+ 开发库，以及 GTK / WebKitGTK 开发库。
- Tauri v2 CLI。

Ubuntu / Debian 系统依赖：

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libunwind-dev \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly gstreamer1.0-libav \
  libasound2-dev libssl-dev librsvg2-dev patchelf pkg-config

cargo install tauri-cli --version "^2" --locked
```

安装前端依赖并启动：

```bash
npm --prefix apps/rustplayer-tauri/frontend ci
cd apps/rustplayer-tauri
cargo tauri dev
```

在 `apps/rustplayer-tauri` 目录构建安装包：

```bash
cargo tauri build --bundles deb,appimage -- --locked
```

## 验证

在仓库根目录运行：

```bash
npm --prefix apps/rustplayer-tauri/frontend test
npm --prefix apps/rustplayer-tauri/frontend run build
cargo test --workspace --locked
```

测试覆盖播放竞态、重试、队列、推荐反馈、背景素材、场景轮换和预览动画。Rust 音频回归使用本地 WAV 与 `fakesink`，无需音源账号或声卡。界面验收范围见 [UI 分支评审](docs/design/ui-branch-review.md)与[视觉场景验证](docs/design/visual-scenes-validation.md)。

当前高分辨率场景仍有长帧，普通集显、8GB、60Hz 设备的性能验收尚待完成；本机验证结果不代表所有设备稳定达到 60fps。

## 快捷键

| 按键 | 操作 |
| --- | --- |
| `Space` | 播放 / 暂停 |
| `↑` / `↓` | 音量调整 5% |
| `←` / `→` | 快退 / 快进 5 秒 |
| `Ctrl+B` | 切换侧边栏 |
| `Escape` | 关闭当前菜单、取消队列确认或退出沉浸界面 |
| 歌曲行 `Enter` / `Space` | 播放这首并保留队列 |
| 歌曲行 `Shift+F10` | 打开歌曲菜单 |
| 队列 `↑` / `↓` / `Home` / `End` | 移动焦点，支持跨虚拟列表定位 |
| 搜索框 `Enter`（开发分支） | 立即搜索；输入法选词期间不提交 |
| 搜索音源 `←` / `→` / `Home` / `End` | 切换音源并移动标签焦点 |

输入框、滑块、菜单和按钮优先处理自身按键，避免一次操作触发多个播放动作。

## 后续方向

首页、导航与搜索反馈已在开发分支完成，下一步为本轮分支评审与合并，再打磨沉浸界面的视觉一致性和场景库体验。电台会话、歌词读取模型重构及后续压力测试暂缓；新增音源与签到保留为后续候选。具体状态见[开发路线](docs/roadmap.md)。

## License

[MIT](LICENSE)
