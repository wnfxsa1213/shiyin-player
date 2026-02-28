# Team Plan: fix-showoff-features

## 概述
修复4个"炫技"前端特性的实现缺陷，使其在实际体验中真正可感知。

## Codex 分析摘要
1. **PlaybackProgress**: subscribe 未用 selector 导致全量触发；durationMs 仍走 React 订阅抵消优化收益；拖拽 mouseUp 在控件外释放会卡死 isDraggingRef。
2. **Dynamic Theming**: CSS 变量 transition 对未注册的自定义属性无效（颜色瞬跳而非平滑过渡）；平均色算法产出灰蒙色；仅更新 --accent/--shadow-glow，未同步 --accent-hover/--accent-active/--shadow-glow-strong 等衍生 token；异步提色缺竞态保护。
3. **Shared Layout**: 缺少 LayoutGroup 包裹；父级 motion.div 的 opacity/y 动画遮蔽子元素 layout 动画；PlayerBar z-50 > LyricsPanel z-40 导致共享元素被遮挡；AnimatePresence 未设 mode="wait"。
4. **Spectrum**: 无 DPR 处理高分屏模糊；每帧 shadowBlur 性能黑洞；magnitudes 全 0 时空跑 rAF；未检查 enabled 开关。

## Gemini 分析摘要
1. **PlaybackProgress**: 直接修改 input.value 不触发 CSS 伪元素（轨道填充色）更新，视觉脱节。
2. **Dynamic Theming**: CSS 变量不可动画导致颜色"闪跳"；平均色经常偏暗偏灰，"界面变脏"而非"流光溢彩"。
3. **Shared Layout**: 两个同 layoutId 组件同时存在 DOM 中，Framer Motion 混淆，出现残影或动画失效。
4. **Spectrum**: opacity-20 让频谱几乎不可见，付出巨大性能代价换来微乎其微的视觉反馈；建议用 CSS filter drop-shadow 替代 Canvas shadowBlur。

## 技术方案

### 关键技术决策
- CSS 变量动画：使用 `@property` 注册 `--accent` 为 `<color>` 类型，使其可被 transition 动画化
- 色彩提取：升级为 HSL 空间主色提取 + 饱和度/亮度约束，确保提取色鲜艳
- 共享布局：引入 LayoutGroup + 源图像在面板打开时隐藏，避免双 layoutId 冲突
- 频谱渲染：DPR 适配 + CSS drop-shadow 替代 Canvas shadowBlur + enabled 门控

<!-- PLAN_TASKS_START -->

## 子任务列表

### Task 1: 修复 PlaybackProgress 瞬态更新
- **类型**: 前端
- **文件范围**:
  - `apps/rustplayer-tauri/frontend/src/components/player/PlaybackProgress.tsx`
  - `apps/rustplayer-tauri/frontend/src/styles/theme.css` (进度条轨道填充样式)
- **依赖**: 无
- **实施步骤**:
  1. 移除 `const durationMs = usePlayerStore((s) => s.durationMs)` 的 React 订阅
  2. 在 subscribe 回调中同时读取 positionMs 和 durationMs，通过 ref 更新所有 DOM 元素（时间文本、input value、input max、右侧 duration 文本）
  3. 在 subscribe 回调中计算进度百分比，通过 `inputRef.current.style.setProperty('--progress', ...)` 设置 CSS 变量
  4. 在 theme.css 中为 `input[type="range"]` 添加基于 `--progress` 变量的轨道填充渐变样式（已播放部分用 --accent 色）
  5. 将拖拽事件从 mouseDown/mouseUp 改为 pointerDown + window 级 pointerup/pointercancel 监听，防止指针在控件外释放时 isDraggingRef 卡死
  6. render 中移除所有 `usePlayerStore.getState()` 调用，改用 ref 初始化
- **验收标准**:
  - 播放时 PlaybackProgress 组件零 React 重渲染（可用 React DevTools Profiler 验证）
  - 进度条轨道填充色随播放进度平滑变化
  - 在进度条外松开鼠标后拖拽状态正确恢复

### Task 2: 修复 Dynamic Theming 色彩萃取与过渡
- **类型**: 前端
- **文件范围**:
  - `apps/rustplayer-tauri/frontend/src/hooks/useDynamicTheme.ts`
  - `apps/rustplayer-tauri/frontend/src/styles/theme.css` (@property 注册)
- **依赖**: 无
- **实施步骤**:
  1. 在 theme.css 顶部添加 `@property --accent { syntax: '<color>'; initial-value: #8B5CF6; inherits: true; }` 注册自定义属性使其可动画
  2. 在 theme.css 的 `:root` 或 `.dark`/`.light` 中添加 `transition: --accent 0.8s ease-in-out`
  3. 重写 `extractAverageColor` 为 `extractDominantColor`：
     - 仍用 Canvas 缩小采样（可提升到 20x20）
     - 将像素转换为 HSL 空间
     - 过滤低饱和度 (S < 20%) 和极端亮度 (L < 15% 或 L > 90%) 的像素
     - 对剩余像素按色相 (H) 分桶（12 桶，每桶 30°），取最大桶的平均 HSL
     - 强制输出饱和度 >= 50%、亮度在 45%~65% 范围内，确保颜色鲜艳
     - 返回 HSL 格式字符串
  4. 在 useDynamicTheme 的 useEffect 中，提色成功后同步更新全套衍生 token：
     - `--accent-hover`: 亮度 +10%
     - `--accent-active`: 亮度 -10%
     - `--accent-subtle`: 同色 alpha 0.15
     - `--accent-glow`: 同色 alpha 0.25
     - `--shadow-glow`: 基于新色的发光阴影
     - `--shadow-glow-strong`: 更强发光
  5. 添加竞态保护：提色前记录 coverUrl，回调时校验是否仍为当前曲目
  6. 移除 `root.style.transition = '--accent 0.8s ease, ...'`（已由 CSS @property + transition 处理）
- **验收标准**:
  - 切歌时主题色在 ~800ms 内平滑过渡（无闪跳）
  - 提取色饱和度高、视觉鲜艳（非灰蒙色）
  - 按钮 hover/active 状态、发光阴影等全部跟随主题色变化

### Task 3: 修复 Framer Motion 共享布局动画
- **类型**: 前端
- **文件范围**:
  - `apps/rustplayer-tauri/frontend/src/App.tsx` (LayoutGroup 包裹)
  - `apps/rustplayer-tauri/frontend/src/components/layout/PlayerBar.tsx` (源图像隐藏)
  - `apps/rustplayer-tauri/frontend/src/components/player/LyricsPanel.tsx` (动画调整)
- **依赖**: 无
- **实施步骤**:
  1. 在 App.tsx 中从 framer-motion 导入 `LayoutGroup`，用 `<LayoutGroup>` 包裹包含 PlayerBar 和 LyricsPanel 的容器
  2. 将 `lyricsOpen` 状态通过 props 传递给 PlayerBar（或提升到 uiStore）
  3. 在 PlayerBar.tsx 中，当 lyricsOpen 为 true 时，将 `motion.img` / `motion.div`（layoutId="cover-shared"）的 opacity 设为 0（通过 style 而非 className，避免影响 layout 计算）
  4. 在 LyricsPanel.tsx 中，将父级 `motion.div` 的入场动画与封面的 layout 动画解耦：
     - 父容器只做 opacity 淡入（不做 y 位移），避免干扰子元素的 layout 动画
     - 或将封面 `motion.img` 移到 AnimatePresence 的直接子级
  5. 确保 LyricsPanel 的 z-index (z-40) 在动画期间不被 PlayerBar (z-50) 遮挡：
     - 方案 A: LyricsPanel 提升到 z-50 以上
     - 方案 B: 打开时临时降低 PlayerBar 的 z-index
  6. AnimatePresence 添加 `mode="wait"` 确保退出动画完成后再进入
- **验收标准**:
  - 点击封面时，小封面平滑放大飞到歌词页大封面位置（spring 弹簧动画）
  - 关闭歌词页时，大封面平滑缩小飞回底部播放栏
  - 无残影、无闪烁、无瞬间跳变

### Task 4: 修复 Canvas 频谱可视化
- **类型**: 前端
- **文件范围**:
  - `apps/rustplayer-tauri/frontend/src/components/player/SpectrumVisualizer.tsx`
  - `apps/rustplayer-tauri/frontend/src/components/layout/PlayerBar.tsx` (频谱容器样式微调)
- **依赖**: 无
- **实施步骤**:
  1. 添加 DPR 适配：
     ```
     const dpr = window.devicePixelRatio || 1;
     canvas.width = width * dpr;
     canvas.height = height * dpr;
     ctx.scale(dpr, dpr);
     ```
  2. 移除 Canvas 内的 `ctx.shadowBlur` 和 `ctx.shadowColor`，改为在 canvas 元素上添加 CSS `filter: drop-shadow(0 0 8px var(--accent))`
  3. 添加 enabled 门控：从 visualizerStore 读取 enabled 状态，disabled 时不启动 rAF 循环
  4. 添加空数据门控：当 magnitudes 全为 0 时跳过绘制（仅 clearRect），降低 GPU 开销
  5. 在 PlayerBar.tsx 中将频谱容器的 `opacity-20` 提升到 `opacity-40` 或更高，让频谱效果更可见
  6. 优化颜色读取：将 getComputedStyle 调用频率从每 30 帧降低到仅在 --accent 变化时更新（可通过 MutationObserver 监听 style 属性变化，或直接从 useDynamicTheme 暴露当前色值）
- **验收标准**:
  - 高分屏上频谱柱状图边缘清晰锐利
  - 频谱发光效果可见且不卡顿
  - 未播放时 rAF 不空跑
  - 频谱颜色跟随主题色变化

<!-- PLAN_TASKS_END -->

## 文件冲突检查
⚠️ 以下文件被多个 Task 涉及，已通过隔离策略解决：
- `theme.css`: Task 1 修改进度条轨道样式区域，Task 2 修改顶部 @property 注册区域 — **不同区域，无冲突**
- `PlayerBar.tsx`: Task 3 修改封面 opacity 逻辑，Task 4 修改频谱容器 opacity — **不同元素，无冲突**
- `App.tsx`: 仅 Task 3 修改（添加 LayoutGroup）— **无冲突**

✅ 4 个 Task 可安全并行执行

## 并行分组
- **Layer 1 (全部并行)**: Task 1, Task 2, Task 3, Task 4
  - 文件范围已隔离，无依赖关系，可同时分配给 4 个 Builder

## 时间戳
- 创建时间: 2026-02-24 22:48:14
