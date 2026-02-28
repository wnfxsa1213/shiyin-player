# 修复计划 v2：Dynamic Theming + Shared Layout 动画

> 基于 Codex (55/100) + Gemini (77/100) 审查意见修订

## 任务类型
- [x] 全栈（后端新增 command + 前端重构两个特性）

## 问题诊断（不变）

### 问题 1：Dynamic Theming CORS 失败
- **根因**：`useDynamicTheme.ts` 用 `img.crossOrigin = 'Anonymous'` + Canvas `getImageData()`，封面 CDN 不返回 CORS 头，`getImageData()` 抛 SecurityError 被静默吞掉，永远回退默认紫色

### 问题 2：Shared Layout 动画断裂
- **根因**：`AnimatePresence mode="wait"` 与 `layoutId` FLIP 动画冲突 + `opacity` hack 破坏源元素

---

## 修复方案（v2 — 采纳审查意见）

### Fix 1：后端直接计算主色调（采纳 Codex 建议）

> 原方案返回 base64 图片，两个审查都指出 IPC 传输大 payload 会阻塞主线程。
> Codex 建议"后端直接算色，从根本上消灭大 payload"，Gemini 也建议避免 Base64。
> 新方案：后端下载封面缩图 → 提取主色调 → 只返回 HSL 三元组。

#### 1.1 后端：新增 `extract_cover_color` Tauri command

**文件**：`apps/rustplayer-tauri/src-tauri/src/commands/mod.rs`

```rust
#[tauri::command]
pub async fn extract_cover_color(
    url: String,
    http: State<'_, reqwest::Client>,
) -> Result<[f64; 3], String> {
    // 1. URL 安全校验
    //    - 只允许 https://
    //    - 域名白名单：music.163.com, p*.music.126.net, y.qq.com, *.y.qq.com 等封面 CDN
    //    - 拒绝 localhost/私网 IP/file:/data:
    //
    // 2. 流式下载（边读边计数，上限 2MB）
    //    - connect_timeout: 3s, total timeout: 8s
    //    - Content-Length 预判，超限直接拒绝
    //    - magic bytes 嗅探：只允许 JPEG (FF D8) / PNG (89 50) / WebP (52 49)
    //
    // 3. 用 image crate 解码 → resize 到 20x20 → 提取像素
    //    - 复用现有 HSL 色桶算法（从前端移植到 Rust）
    //    - 12 个 30° 色相桶，过滤低饱和度/极端亮度
    //    - 强制鲜艳：s >= 50%, l clamp(45, 65)
    //
    // 4. 返回 [h, s, l] 三元组（几十字节，零 IPC 压力）
}
```

**新增依赖** (`src-tauri/Cargo.toml`)：
- `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }` — 直接依赖，同版本
- `image = { version = "0.25", default-features = false, features = ["jpeg", "png", "webp"] }` — 图片解码+缩放

**安全措施**（采纳 Codex 审查）：
- 域名白名单 + 重定向逐跳校验（`redirect::Policy::custom`）
- 流式读取 + 2MB 硬限制
- magic bytes 嗅探，拒绝非图片响应
- 复用 `reqwest::Client`，放入 Tauri State（不每次新建）

#### 1.2 前端：IPC 封装

**文件**：`frontend/src/lib/ipc.ts`

```typescript
extractCoverColor: (url: string) => invoke<[number, number, number]>('extract_cover_color', { url }),
```

#### 1.3 前端：简化 `useDynamicTheme.ts`

核心改动：
- 删除整个 `extractDominantColor` 函数（Canvas 提取逻辑移到后端）
- 删除 `rgbToHsl`、`hslToRgb` 等颜色转换工具函数（后端直接返回 HSL）
- 改为调用 `ipc.extractCoverColor(coverUrl)` 获取 `[h, s, l]`
- 新增 LRU 缓存（Map + 100 条上限，采纳 Gemini 建议）
- 保留 `applyTheme(h, s, l)` 和竞态保护逻辑

```typescript
const colorCache = new Map<string, [number, number, number]>();
const CACHE_MAX = 100;

export function useDynamicTheme() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  useEffect(() => {
    if (!currentTrack?.coverUrl) { applyTheme(DEFAULT_H, DEFAULT_S, DEFAULT_L); return; }
    const url = currentTrack.coverUrl;
    // 缓存命中
    if (colorCache.has(url)) { applyTheme(...colorCache.get(url)!); return; }
    // IPC 调用后端提取
    ipc.extractCoverColor(url).then(([h, s, l]) => {
      if (usePlayerStore.getState().currentTrack?.coverUrl !== url) return; // 竞态保护
      if (colorCache.size >= CACHE_MAX) colorCache.delete(colorCache.keys().next().value!);
      colorCache.set(url, [h, s, l]);
      applyTheme(h, s, l);
    }).catch(() => applyTheme(DEFAULT_H, DEFAULT_S, DEFAULT_L));
  }, [currentTrack?.coverUrl]);
}
```

### Fix 2：重新设计 Shared Layout 动画（采纳 Gemini 建议）

> Gemini 确认条件渲染 + layoutId 是 framer-motion 标准做法。
> 但反对"始终挂载 LyricsPanel"，粒子系统和 Canvas 会后台空转。
> 新方案：保持条件渲染，去掉 `mode="wait"`，重量级子组件内部做门控。

#### 2.1 核心策略

- **保持** `isOpen` 条件渲染 LyricsPanel（不始终挂载）
- **去掉** `<AnimatePresence mode="wait">`，改为无 mode 的 `<AnimatePresence>`（允许新旧组件共存）
- 封面用条件渲染：同一时刻只有一个 `layoutId="cover-shared"` 存在
- 显式加 `layout` prop：`<motion.img layout layoutId="cover-shared" />`（Gemini 建议）

#### 2.2 PlayerBar.tsx 改动

- **移除** `style={{ opacity: lyricsOpen ? 0 : 1 }}` hack
- 改为条件渲染：`{!lyricsOpen && <motion.img layout layoutId="cover-shared" ... />}`
- 确认父容器 `overflow-hidden` 不会裁切飞行动画（检查 footer 的 overflow 属性）

#### 2.3 LyricsPanel.tsx 改动

- `<AnimatePresence mode="wait">` → `<AnimatePresence>`（去掉 mode）
- 外层 `motion.div` 保留 `initial/animate/exit` 的 opacity 动画（背景淡入淡出）
- 封面 `motion.img` 加 `layout` prop + spring transition：
  ```tsx
  <motion.img
    layout
    layoutId="cover-shared"
    transition={{ layout: { type: 'spring', stiffness: 200, damping: 28 } }}
  />
  ```
- **重量级子组件门控**（采纳 Gemini 建议）：
  - `ParticleSystem` 内部已有 `enabled` 门控，无需额外处理
  - 歌词 fetch 的 useEffect 已有 `if (!isOpen)` 门控，无需额外处理

#### 2.4 App.tsx
- `<LayoutGroup>` 已正确包裹，无需改动

#### 2.5 overflow 裁切处理（采纳 Gemini 建议）
- PlayerBar footer 有 `overflow-hidden`，飞行中封面可能被截断
- 解决：将 PlayerBar 的 `overflow-hidden` 改为 `overflow-visible`，频谱背景层单独用 `overflow-hidden` 的 wrapper

---

## 实施顺序

| 步骤 | 文件 | 改动 |
|------|------|------|
| 1 | `src-tauri/Cargo.toml` | 添加 `reqwest` + `image` 依赖 |
| 2 | `src-tauri/src/commands/mod.rs` | 新增 `extract_cover_color` command（含安全校验） |
| 3 | `src-tauri/src/main.rs` | 注册 command + 管理 reqwest::Client State |
| 4 | `frontend/src/lib/ipc.ts` | 新增 `extractCoverColor` IPC 方法 |
| 5 | `frontend/src/hooks/useDynamicTheme.ts` | 简化：删除 Canvas 逻辑，调用后端 + LRU 缓存 |
| 6 | `frontend/src/components/layout/PlayerBar.tsx` | 条件渲染封面 + 修复 overflow |
| 7 | `frontend/src/components/player/LyricsPanel.tsx` | 去掉 mode="wait" + 加 layout prop + spring |

## 验收标准

1. 切歌后，全局主题色随封面变化，800ms 平滑过渡（不再永远紫色）
2. 点击封面 → 封面从 PlayerBar 48x48 弹簧飞行到 LyricsPanel 384x384
3. 关闭歌词 → 封面弹簧飞回 PlayerBar
4. 无封面歌曲回退默认紫色，placeholder 也有 layout 动画
5. 飞行过程中封面不被父容器裁切
6. 歌词面板关闭时无后台 CPU 消耗

## 审查追溯

| 审查方 | 评分 | 关键采纳 |
|--------|------|----------|
| Codex | 55/100 | 后端直接算色、域名白名单、流式限流、复用 Client、magic bytes 嗅探 |
| Gemini | 77/100 | 去掉 mode="wait" 而非始终挂载、加 layout prop、LRU 上限、overflow 处理、spring 参数确认 |
