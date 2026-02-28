# 修复计划：Dynamic Theming + Shared Layout 动画

## 任务类型
- [x] 全栈（后端新增 command + 前端重构两个特性）

## 问题诊断

### 问题 1：Dynamic Theming CORS 失败
- **根因**：`useDynamicTheme.ts` 用 `img.crossOrigin = 'Anonymous'` + Canvas `getImageData()`，但网易云/QQ 音乐封面 CDN 不返回 CORS 头，`getImageData()` 抛 SecurityError 被静默吞掉，永远回退默认紫色
- **影响**：动态主题色功能在实际运行中完全失效

### 问题 2：Shared Layout 动画断裂
- **根因**：LyricsPanel 用 `AnimatePresence mode="wait"` 包裹，exit 动画要求旧元素先完全移除再挂载新元素，但 layout 动画需要两个 `layoutId` 元素同时存在才能计算位置插值。加上 PlayerBar 里 `opacity: lyricsOpen ? 0 : 1` 的 hack，源元素直接隐藏，layout 飞行动画无从发生
- **影响**：点击封面展开歌词时，实际效果是两个独立 fade，不是连贯的位置跃迁

---

## 修复方案

### Fix 1：封面代理 + Blob URL 绕过 CORS

#### 1.1 后端：新增 `fetch_cover` Tauri command

**文件**：`apps/rustplayer-tauri/src-tauri/src/commands/mod.rs`

```rust
// 新增：通过后端 reqwest 下载封面图片字节，返回 base64 编码
// 绕过前端 Canvas 的 CORS 限制
#[tauri::command]
pub async fn fetch_cover(url: String) -> Result<String, String> {
    // 校验 URL 合法性
    // 用 reqwest 下载图片字节（复用已有的 reqwest 依赖）
    // base64 编码后返回 data:image/xxx;base64,... 格式
    // 限制最大 2MB 防止滥用
}
```

- 添加 `base64` 依赖到 `src-tauri/Cargo.toml`
- 在 `main.rs` 的 `generate_handler!` 中注册 `commands::fetch_cover`

#### 1.2 前端：IPC 封装

**文件**：`apps/rustplayer-tauri/frontend/src/lib/ipc.ts`

```typescript
// 新增
fetchCover: (url: string) => invoke<string>('fetch_cover', { url }),
```

#### 1.3 前端：重写 `useDynamicTheme.ts`

**文件**：`apps/rustplayer-tauri/frontend/src/hooks/useDynamicTheme.ts`

核心改动：
- `extractDominantColor` 不再用 `new Image()` + crossOrigin，改为：
  1. 调用 `ipc.fetchCover(coverUrl)` 获取 base64 data URL
  2. 用该 data URL 创建 Image → Canvas → getImageData（data URL 无 CORS 问题）
- 新增 `Map<string, [number, number, number]>` 缓存，避免同一封面重复提取
- 保留现有的竞态保护逻辑和 HSL 色桶算法（算法本身没问题）

### Fix 2：重新设计 Shared Layout 动画

#### 2.1 核心策略变更

**放弃** AnimatePresence 控制 LyricsPanel 的挂载/卸载，改为：
- LyricsPanel 始终挂载在 DOM 中（用 CSS 控制可见性）
- 让 framer-motion 的 layout 动画自然工作：两个 `layoutId="cover-shared"` 元素始终存在，只是位置/尺寸不同
- 用 `motion.div` 的 `animate` 控制歌词面板的背景层淡入淡出（不影响封面的 layout 动画）

#### 2.2 PlayerBar.tsx 改动

- **移除** `style={{ opacity: lyricsOpen ? 0 : 1 }}` hack
- 当 `lyricsOpen` 时，PlayerBar 的封面元素不渲染（条件渲染），让 `layoutId` 只存在于 LyricsPanel 中
- 这样 framer-motion 会自动计算从 PlayerBar 位置到 LyricsPanel 位置的 layout 动画

**关键实现**：使用条件渲染而非 opacity 隐藏

```tsx
// PlayerBar 中：
{!lyricsOpen && (
  <motion.img layoutId="cover-shared" ... />
)}

// LyricsPanel 中：
{lyricsOpen && (
  <motion.img layoutId="cover-shared" ... />
)}
```

当 `lyricsOpen` 从 false → true：
1. PlayerBar 的 `motion.img` 卸载
2. LyricsPanel 的 `motion.img` 挂载
3. framer-motion 检测到同一 `layoutId` 的位置变化，自动生成飞行动画

#### 2.3 LyricsPanel.tsx 改动

- **移除** `<AnimatePresence mode="wait">` 包裹
- 歌词面板的背景层（`bg-bg-base/90 backdrop-blur`）用独立的 `motion.div` + `animate={{ opacity }}` 控制淡入淡出
- 封面的 `motion.img` 不再被 AnimatePresence 控制，直接由 `isOpen` 条件渲染
- 添加 `layout transition` 配置：`transition={{ layout: { type: 'spring', stiffness: 200, damping: 28 } }}`

#### 2.4 App.tsx

- `<LayoutGroup>` 已正确包裹，无需改动

---

## 实施顺序

| 步骤 | 文件 | 改动 |
|------|------|------|
| 1 | `src-tauri/Cargo.toml` | 添加 `base64` 和 `reqwest` 依赖 |
| 2 | `src-tauri/src/commands/mod.rs` | 新增 `fetch_cover` command |
| 3 | `src-tauri/src/main.rs` | 注册 `fetch_cover` 到 `generate_handler!` |
| 4 | `frontend/src/lib/ipc.ts` | 新增 `fetchCover` IPC 方法 |
| 5 | `frontend/src/hooks/useDynamicTheme.ts` | 重写：IPC 获取 base64 + 缓存 |
| 6 | `frontend/src/components/layout/PlayerBar.tsx` | 移除 opacity hack，条件渲染封面 |
| 7 | `frontend/src/components/player/LyricsPanel.tsx` | 移除 AnimatePresence，重构动画策略 |

## 验收标准

1. 切歌后，全局主题色（按钮、发光、歌词渐变）随封面变化，800ms 平滑过渡
2. 点击封面 → 封面从 PlayerBar 48x48 位置弹簧飞行到 LyricsPanel 384x384 位置
3. 关闭歌词 → 封面从大图位置弹簧飞回 PlayerBar 小图位置
4. 无封面的歌曲回退默认紫色主题，placeholder 图标也有 layout 动画
