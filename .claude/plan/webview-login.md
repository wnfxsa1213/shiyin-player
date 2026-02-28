# WebView 弹窗登录 — WBS 实施计划

**规划时间**：2026-02-25 | **任务类型**：全栈 | **预估**：16 任务点

## 1. 功能概述

用户在设置页点击"登录"后，打开 Tauri WebView 窗口加载官方登录页（网易云/QQ音乐），登录完成后自动检测关键 Cookie（网易云: `MUSIC_U`，QQ音乐: `qqmusic_key`/`Q_H_L`），持久化存储并注入 MusicSource client，关闭窗口，前端收到 `login://success` 事件后刷新状态。保留手动 Cookie 粘贴作为备用入口。

**不包含**：扫码登录、密码登录、登录态自动刷新
**技术约束**：Tauri v2 WebviewWindowBuilder | webview.eval() 定时轮询 Cookie | 5 分钟超时

---

## 2. 任务索引

| ID | 模块 | 任务 | 点数 | 文件 | 依赖 |
|----|------|------|------|------|------|
| A.1 | 后端/core | MusicSource trait 新增 `is_logged_in()` | 1 | core/lib.rs, netease/lib.rs, qqmusic/lib.rs | 无 |
| B.1 | 后端/tauri | `open_login_window` command | 5 | commands/mod.rs | D.1, D.2 |
| B.2 | 后端/tauri | `check_login_status` command | 1 | commands/mod.rs | A.1 |
| B.3 | 后端/tauri | 注册新 command 到 main.rs | 1 | main.rs | B.1, B.2 |
| B.4 | 后端/tauri | login command 补发 `login://success` 事件 | 1 | commands/mod.rs | 无 |
| C.1 | 前端 | ipc.ts 新增接口 + 事件监听 | 1 | ipc.ts | B.3 |
| C.2 | 前端 | SettingsView UI 改造 | 3 | SettingsView.tsx | C.1 |
| C.3 | 前端 | App.tsx 监听登录事件 | 1 | App.tsx | C.1 |
| D.1 | 配置 | tauri.conf.json CSP 验证 | 1 | tauri.conf.json | 无 |
| D.2 | 配置 | capabilities 新增窗口权限 | 1 | default.json | 无 |

## 3. 执行顺序

Phase 1（并行）：A.1 + D.1 + D.2 + B.4
Phase 2（并行）：B.1 + B.2
Phase 3：B.3
Phase 4：C.1
Phase 5（并行）：C.2 + C.3

---

## 4. 详细任务描述

### A.1 MusicSource trait 新增 `is_logged_in()`

- `crates/core/src/lib.rs` trait 中添加默认方法 `fn is_logged_in(&self) -> bool { false }`
- `crates/netease/src/lib.rs` 覆盖实现：`self.cookie.read().ok().map_or(false, |g| g.is_some())`
- `crates/qqmusic/src/lib.rs` 同上
- 验收：`cargo check` 通过

### B.1 实现 `open_login_window` command

- 新增 `#[tauri::command] pub async fn open_login_window(source, trace_id, app, registry)`
- 根据 source 确定 URL 和关键 Cookie：
  - 网易云：`https://music.163.com/#/login` → 检测 `MUSIC_U`
  - QQ音乐：`https://y.qq.com/` → 检测 `qqmusic_key` 或 `Q_H_L`
- `WebviewWindowBuilder::new(&app, "login-window", WebviewUrl::External(url))` 创建 900x700 居中窗口
- 异步任务每 2 秒 `eval()` 注入 JS 检查 `document.cookie`
- Cookie 回传方案：注入 JS 调用 `window.__TAURI__.event.emit('__cookie_found', cookie)`，后端 listen
- 检测到关键 Cookie → save_cookie → login 注入 → 关闭窗口 → emit `login://success`
- 5 分钟超时 → 关闭窗口 → emit `login://timeout`
- 窗口关闭事件清理定时器（`Arc<AtomicBool>` 标记）

### B.2 实现 `check_login_status` command

- 返回 `HashMap<MusicSourceId, bool>` 各音源登录状态
- 遍历 `registry.all()` 调用 `is_logged_in()`

### B.3 注册新 command 到 main.rs

- `generate_handler!` 中添加 `commands::open_login_window, commands::check_login_status`

### B.4 login command 补发事件

- 现有 login 成功后添加 `app.emit("login://success", source)`
- 手动 Cookie 登录也能触发前端状态刷新

### C.1 ipc.ts 新增接口

```typescript
openLoginWindow: (source: MusicSource) =>
  invokeWithTrace<void>('open_login_window', { source }),
checkLoginStatus: () =>
  invokeWithTrace<Record<MusicSource, boolean>>('check_login_status'),
```

新增事件监听：
```typescript
export function onLoginSuccess(cb: (source: MusicSource) => void): Promise<UnlistenFn>
export function onLoginTimeout(cb: (source: MusicSource) => void): Promise<UnlistenFn>
```

### C.2 SettingsView UI 改造

**状态机**：`idle → webview-pending → logged-in`（按音源独立追踪）

**三态 UI**：
- 未登录：一键登录按钮（accent 全宽）+ 折叠的"高级选项"手动 Cookie 输入
- 登录中：按钮禁用 + spinner + "请在弹出窗口中完成登录"提示
- 已登录：CheckCircle 图标 + "已登录" + 登出按钮

**折叠动画**：`grid-rows` + `transition-all duration-300`

**图标**：LogIn, Loader2, CheckCircle, Info, ChevronRight（lucide-react）

### C.3 App.tsx 监听登录事件

- useEffect 中添加 `onLoginSuccess` → Toast + fetchPlaylists
- 添加 `onLoginTimeout` → Toast 超时提示

---

## 5. 配置变更

### D.1 CSP 验证

Tauri v2 的 `WebviewWindowBuilder` + `WebviewUrl::External` 创建独立窗口，不受主窗口 CSP 限制。需实测确认，如被拦截则添加 `frame-src` 规则。

### D.2 capabilities/default.json

```json
{
  "windows": ["main", "login-window"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "store:default",
    "core:window:allow-create",
    "core:window:allow-close",
    "core:event:default"
  ]
}
```

---

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| eval() 受目标网站 CSP 限制 | 备选：on_navigation 事件监听 URL 变化 |
| 登录页检测非浏览器环境 | 设置 WebView User-Agent 为标准 Chrome UA |
| document.cookie 无法读取 HttpOnly Cookie | MUSIC_U 通常非 HttpOnly；否则需底层 cookie store API |
| 窗口关闭后异步任务泄漏 | Arc<AtomicBool> 标记 + 轮询检查 |

## 7. 验收标准

- [ ] 点击"一键登录"弹出 WebView 窗口加载对应平台登录页
- [ ] 用户登录后窗口自动关闭，Toast 提示"登录成功"
- [ ] 设置页显示"已登录"状态，歌单列表自动刷新
- [ ] 重启应用后登录态保持
- [ ] 登出后状态清除
- [ ] 手动 Cookie 粘贴仍可用（折叠在"高级选项"）
- [ ] 5 分钟超时自动关闭并提示
- [ ] `cargo check` 和 `npm run build` 均通过
