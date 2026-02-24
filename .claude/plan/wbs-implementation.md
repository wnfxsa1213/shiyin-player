# RustPlayer 11 项功能 WBS 实施计划

**日期**：2026-02-24 | **总工作量**：55 点 | **路径前缀省略** `apps/rustplayer-tauri/`

## 概述
补齐队列/歌单/交互/持久化，使 RustPlayer 成为完整播放器。不含密码登录、歌单CRUD、在线同步。

---

## Phase 1：核心基础（21 点）

### A. 播放队列 Store（5 点） — `frontend/src/store/playerStore.ts` 修改

- [ ] **A.1** 队列类型定义（1点）
  - 新增字段：`queue: Track[]`, `queueIndex: number`, `playMode: 'sequence'|'repeat-one'|'shuffle'`, `shuffleOrder: number[]`
  - 验收：TS编译通过，现有功能不受影响

- [ ] **A.2** 队列操作方法（2点）
  - 实现：`addToQueue(tracks)` 追加去重、`insertNext(track)` 插入下一位、`removeFromQueue(index)` 移除调整index、`clearQueue`、`setPlayMode`（shuffle时Fisher-Yates）、`playFromQueue(index)` 设index+调ipc
  - 验收：增删改查状态正确

- [ ] **A.3** playNext / playPrev（2点）
  - sequence: ±1循环 | repeat-one: 重播 | shuffle: 按shuffleOrder
  - App.tsx 监听 `stopped` → 自动 `playNext()`
  - 修改文件：`frontend/src/App.tsx`（onPlayerState回调增加stopped处理）
  - 验收：三种模式切歌正确

### B. Toast 通知（3 点）

- [ ] **B.1** toastStore（1点） — 新建 `frontend/src/store/toastStore.ts`
  - 类型：`Toast { id, type: success|error|info, message, duration }`
  - 方法：`addToast(type, message)` 生成nanoid、最多3条、`removeToast(id)`
  - 3秒后 setTimeout 自动移除
  - 验收：store 可正常增删 toast

- [ ] **B.2** ToastContainer 组件（2点） — 新建 `frontend/src/components/common/ToastContainer.tsx`
  - fixed 右上角 `top-4 right-4 z-50`，最多渲染3条
  - 图标：CheckCircle(green) / XCircle(red) / Info(blue)，来自 lucide-react
  - 动画：`animate-slide-in-right`（需在 tailwind.config 添加 keyframes）
  - 在 App.tsx 中挂载 `<ToastContainer />`
  - 验收：调用 addToast 后右上角显示通知，3秒消失

### C. tauri-plugin-store 设置持久化（5 点）

- [ ] **C.1** 前端 store 封装（2点） — 新建 `frontend/src/lib/settings.ts`
  - 安装 `@tauri-apps/plugin-store`（npm依赖）
  - 封装 `loadSettings()` / `saveSettings(key, value)` 异步函数
  - 持久化字段：theme, volume, visualizer(enabled/mode/showParticles/colors)
  - 验收：可读写 tauri store

- [ ] **C.2** uiStore 持久化改造（1点） — 修改 `frontend/src/store/uiStore.ts`
  - `toggleTheme` 时调 `saveSettings('theme', newTheme)`
  - App.tsx 启动时 `loadSettings()` → `useUiStore.setState({ theme })`
  - 验收：切换主题后重启保持

- [ ] **C.3** playerStore 音量持久化（1点） — 修改 `frontend/src/store/playerStore.ts`
  - `setVolume` 时调 `saveSettings('volume', v)`
  - 启动时恢复 volume
  - 验收：调整音量后重启保持

- [ ] **C.4** visualizerStore 迁移到 plugin-store（1点） — 修改 `frontend/src/store/visualizerStore.ts`
  - 替换 localStorage → tauri-plugin-store
  - 验收：可视化设置重启保持，localStorage 不再使用

### D. Cookie 加密存储 + WebView 登录（8 点）

- [ ] **D.1** 后端 store 读写封装（2点） — 新建 `src-tauri/src/store.rs`
  - 使用 `tauri_plugin_store::StoreExt` 读写 `credentials.json`
  - 封装 `save_cookie(app, source, cookie)` / `load_cookie(app, source)` / `delete_cookie`
  - tauri-plugin-store 自带加密（配合 Tauri 的 app data 目录）
  - 验收：Cookie 可持久化到磁盘

- [ ] **D.2** WebView 弹窗登录（3点） — 新建 `src-tauri/src/login_window.rs`
  - 新增 IPC command `open_login_window(source)`
  - 后端创建新 Tauri WebView 窗口，加载登录页：
    - 网易云：`https://music.163.com/#/login`
    - QQ音乐：`https://y.qq.com/` 登录入口
  - 监听窗口 navigation/cookie 事件，检测关键 Cookie：
    - 网易云：`MUSIC_U` 字段出现
    - QQ音乐：`qqmusic_key` 或 `Q_H_L` 字段出现
  - 检测到后：提取 Cookie → `save_cookie` 持久化 → 注入到 MusicSource client → 关闭登录窗口
  - 向前端发送 `login://success` 事件
  - 注册到 main.rs invoke_handler
  - 验收：点击登录 → WebView 弹窗 → 用户登录 → 自动获取 Cookie → 窗口关闭

- [ ] **D.3** 改造 login command + logout（1点） — 修改 `src-tauri/src/commands/mod.rs`
  - 保留现有 Cookie 粘贴登录作为备用入口
  - login 成功后调 `save_cookie` 持久化
  - 新增 `logout` command 调 `delete_cookie`
  - 注册 logout 到 main.rs invoke_handler
  - 验收：两种登录方式均可用，登出后清除 Cookie

- [ ] **D.4** 启动时恢复 Cookie（1点） — 修改 `src-tauri/src/main.rs`
  - setup 闭包中读取已存储的 Cookie，调用各 source 的 login 恢复会话
  - 验收：重启后无需重新登录

- [ ] **D.5** SettingsView 登录 UI 改造（1点） — 修改 `frontend/src/views/SettingsView.tsx`
  - 主入口改为"一键登录"按钮，调用 `ipc.openLoginWindow(source)`
  - Cookie 粘贴框折叠为"高级：手动粘贴 Cookie"
  - 监听 `login://success` 事件 → Toast 提示"登录成功"
  - 显示已登录状态（登录后按钮变为"已登录 · 登出"）
  - 前端 `lib/ipc.ts` 新增 `openLoginWindow(source)` / `logout(source)`
  - 验收：一键登录流程完整，UI 反馈清晰

---

## Phase 2：页面与组件（22 点）

### E. 上一首/下一首按钮（1 点）

- [ ] **E.1** PlayerBar 绑定逻辑（1点） — 修改 `frontend/src/components/layout/PlayerBar.tsx`
  - SkipBack onClick → `usePlayerStore.getState().playPrev()`
  - SkipForward onClick → `usePlayerStore.getState().playNext()`
  - 依赖：A.3
  - 验收：点击按钮可切歌

### F. 右键上下文菜单（4 点）

- [ ] **F.1** ContextMenu 组件（2点） — 新建 `frontend/src/components/common/ContextMenu.tsx`
  - Props: `{ x, y, track, onClose }`
  - Portal 挂载到 body，position fixed，边界检测（viewport溢出翻转）
  - 样式：w-48, bg-bg-elevated, rounded-xl, shadow-xl, border-border-primary
  - 菜单项：Play / 下一首播放 / 添加到队列 / 复制歌曲名
  - 图标：Play, ListEnd, ListPlus, Copy（lucide-react）
  - 点击外部或 Escape 关闭
  - 动画：scale-in（tailwind keyframes）
  - 验收：右键弹出菜单，各项可点击

- [ ] **F.2** TrackRow 集成右键（1点） — 修改 `frontend/src/components/common/TrackRow.tsx`
  - onContextMenu → preventDefault + 设置 menuState(x, y, track)
  - 渲染 ContextMenu（条件渲染）
  - 验收：TrackRow 右键弹出菜单

- [ ] **F.3** 菜单项逻辑绑定（1点） — 修改 ContextMenu
  - Play → `playFromQueue` 或直接 `ipc.playTrack`
  - 下一首播放 → `insertNext(track)` + toast 提示
  - 添加到队列 → `addToQueue([track])` + toast 提示
  - 复制歌曲名 → `navigator.clipboard.writeText` + toast 提示
  - 依赖：A.2, B.1
  - 验收：各菜单项功能正确，操作后有 toast 反馈

### G. 播放队列面板（5 点）

- [ ] **G.1** QueuePanel 组件（3点） — 新建 `frontend/src/components/player/QueuePanel.tsx`
  - Props: `{ isOpen, onClose }`
  - 右侧滑出 w-80，fixed right-0 top-0 bottom-20（避开PlayerBar），z-40
  - 头部：标题"播放队列" + 清空按钮 + 关闭按钮
  - 播放模式切换栏：Repeat(列表循环) / Repeat1(单曲) / Shuffle(随机)，图标来自 lucide-react
  - QueueItem 列表：显示序号/封面/歌名/歌手，当前播放项高亮（bg-accent-subtle），hover 显示删除按钮(X)
  - 点击 QueueItem → `playFromQueue(index)`
  - 删除按钮 → `removeFromQueue(index)`
  - 动画：slide-in-right / slide-out-right
  - 依赖：A.2
  - 验收：面板可打开关闭，队列可操作

- [ ] **G.2** PlayerBar 集成队列按钮（1点） — 修改 `frontend/src/components/layout/PlayerBar.tsx`
  - 在音量控制旁新增 ListMusic 图标按钮
  - 点击切换 QueuePanel 开关状态
  - 验收：点击按钮可打开/关闭队列面板

- [ ] **G.3** App.tsx 挂载 QueuePanel（1点） — 修改 `frontend/src/App.tsx`
  - 新增 queueOpen state，传递给 PlayerBar 和 QueuePanel
  - 验收：队列面板在应用中正常渲染
