# 性能优化方案 - 双模型交叉验证版

> 基于 Claude + Codex + Gemini 三模型分析，共 46 项瓶颈，按优先级分 4 批实施。
>
> Codex 纠偏：#9 spawn_blocking 运行在专用 blocking pool（非 tokio worker），问题是 blocking pool 排队 + DB pool 排队；#29 sleep(500ms) 不阻塞线程，问题是固定等待拉长尾延迟。

---

## P0 批次：用户直接感知的核心瓶颈 ✅ 已完成 (2026-03-06)

> **实施摘要**：14 个文件修改，+217 / -77 行。双模型交叉审查（Codex + Gemini）通过，审查发现的问题已修复。
>
> **编译验证**：`cargo check` 通过，`npx tsc --noEmit` 通过。

### P0-1. 搜索链路优化（#1 #2 #3 #6） ✅

**#1 网易云未登录多跳请求** ✅
- 根因：`crates/netease/src/api.rs:23` 无论登录状态都先打 cloudsearch，未登录时失败后回退普通搜索 + 补封面详情 = 3 次 HTTP
- 修改文件：`crates/netease/src/lib.rs`, `crates/netease/src/api.rs`
- 实际方案：`AtomicBool` cloudsearch_available 标记，无 cookie 或标记为 false 时直接跳过 cloudsearch；401 Unauthorized 时自动置为 false；login 时重置为 true。封面补全限制为前 5 条。
- 审查备注：封面限制为 5 条可在 P1 改为懒加载回填

**#2 聚合搜索 wait-all 策略** ✅
- 根因：`commands/mod.rs:211` join_all 等所有音源完成，总延迟 = max(所有源)
- 修改文件：`apps/rustplayer-tauri/src-tauri/src/commands/mod.rs`
- 实际方案：`tokio::task::JoinSet` + 首个非空结果后 500ms 软超时 + `abort_all()`；带 `source_index` 标记保证结果顺序稳定（Codex 审查修复）
- 审查备注：软超时返回部分结果无 `partial` 标记 — 推迟到 P1（见下方 P0→P1 遗留项）

**#3 weapi 双重加密开销** ✅
- 根因：`crates/netease/src/crypto.rs:36-45` 每次重新解析 RSA 大整数
- 修改文件：`crates/netease/src/crypto.rs`
- 实际方案：`std::sync::OnceLock` 缓存 RSA BigUint 常量（exponent + modulus），仅首次调用时解析

**#6 前端搜索 debounce 仅 300ms** ✅
- 根因：`SearchView.tsx:18-33` 300ms debounce 不够，切换音源无节流
- 修改文件：`apps/rustplayer-tauri/frontend/src/views/SearchView.tsx`
- 实际方案：关键词 debounce 300ms→450ms；新增 debouncedSource 状态 200ms 防抖；searchSeq 竞态保护

### P0-2. 前端状态风暴（#17 #24 #25） ✅

**#17 频谱数据 60Hz 写入 Zustand** ✅
- 根因：`visualizerStore.ts:56` 每秒 60 次 `set({ magnitudes })`，所有订阅组件重渲染
- 修改文件：`visualizerStore.ts`, `SpectrumVisualizer.tsx`, `ParticleSystem.tsx`, `App.tsx`
- 实际方案：从 store 移除 magnitudes，改用 `spectrumDataRef = { current: Float32Array(64) }`；IPC 回调用 `Float32Array.set()` 原生内存拷贝写入（Gemini 审查修复）；ParticleSystem 低频能量计算改为零分配 for 循环（Gemini 审查修复，避免 `.slice()` 产生 GC 压力）

**#24 App.tsx 订阅整店状态** ✅
- 根因：`App.tsx:43` 解构 playerStore，进度更新导致顶层重渲染
- 修改文件：`App.tsx`
- 实际方案：拆为 4 个独立原子选择器 `usePlayerStore(s => s.play)` 等

**#25 TrackRow 100+ 行重渲染** ✅
- 根因：TrackRow 订阅 currentTrack，任何播放状态变化触发全部重渲染
- 修改文件：`TrackRow.tsx`
- 实际方案：精确布尔选择器 `(s) => s.currentTrack?.id === track.id && s.currentTrack?.source === track.source`，配合 `Object.is` 等值比较，仅新旧两行触发重渲染

### P0-3. 进度条跳动（#11） ✅

**#11 进度更新仅 ~2Hz** ✅
- 根因：`player/lib.rs:283` 约 2Hz 发进度，前端无插值
- 修改文件：`crates/player/src/lib.rs`, `events.rs`, `PlaybackProgress.tsx`, `ipc.ts`
- 实际方案：
  - **后端**：时间驱动 5Hz 进度发射（200ms 间隔，基于 `std::time::Instant`）；状态不匹配检测改为持续 >100ms 才触发（替代 tick 计数）；teardown 重置所有计时器字段（Codex 审查修复）；progress 事件附加 `emittedAtMs` Unix 时间戳
  - **前端**：`PlaybackProgress.tsx` 完全重写为 RAF 60fps 插值模式 — store subscription 捕获 lastServerPos/lastServerTime/isPlaying/lastDur，RAF tick 计算 `pos = Math.min(lastServerPos + elapsed, lastDur)` 实现平滑进度条
- 审查备注：`emittedAtMs` 延迟补偿未在前端使用 — 同机 IPC 延迟可忽略，推迟到 P1

### P0 审查结果汇总

| 审查方 | 评分 | 发现 | 处理 |
|--------|------|------|------|
| **Codex** | — | 2 Major + 3 Minor | Major#2（JoinSet 顺序不稳定）✅ 已修复；Minor#1（teardown 未重置计时器）✅ 已修复；其余推迟 |
| **Gemini** | 95/100 | 2 Major + 1 Minor | Major#1（ParticleSystem .slice() GC 压力）✅ 已修复；Major#2（频谱写入用 .set()）✅ 已修复 |

---

## P0→P1 遗留项（P0 审查中发现，推迟到 P1 处理）

### P1-0a. 搜索软超时 partial 标记（来自 Codex 审查 Major#1）

- 问题：`search_music` 在软超时后返回部分结果，但 IPC 返回类型 `Vec<Track>` 无法标记结果是否完整
- 修改文件：`apps/rustplayer-tauri/src-tauri/src/commands/mod.rs`、前端 `ipc.ts` + `SearchView.tsx`
- 策略：返回类型改为 `{ tracks: Vec<Track>, partial: bool }` 或 `{ tracks: Vec<Track>, sources_completed: Vec<MusicSourceId> }`；前端收到 partial=true 时显示"部分结果"提示
- 推迟原因：需改 IPC 返回类型，影响前后端契约，P0 阶段风险过大

### P1-0b. emittedAtMs 延迟补偿（来自 Gemini 审查 Major）

- 问题：后端 progress 事件附带了 `emittedAtMs` 时间戳，但前端插值逻辑未利用该字段进行漂移补偿
- 修改文件：`apps/rustplayer-tauri/frontend/src/components/player/PlaybackProgress.tsx`
- 策略：`latency = Date.now() - emittedAtMs`，在 `lastServerPos` 中补回延迟量
- 推迟原因：同机 Tauri IPC 延迟通常 <5ms，实际影响极小；弱网/跨机场景不存在

### P1-0c. 封面懒加载回填（来自 Codex 审查 Minor#2）

- 问题：网易云搜索结果封面补全从全量改为前 5 条，后续条目无封面
- 修改文件：`crates/netease/src/api.rs`、前端 `CoverImage.tsx` 或 `TrackRow.tsx`
- 策略：前端在封面图 URL 为空时，按需触发后端 API 获取单曲详情补全封面（lazy cover fetching）
- 推迟原因：不影响核心播放流程，P1 实施更稳妥

### P1-0d. SearchView 组件卸载异步回调清理（来自 Gemini 审查 Minor）

- 问题：SearchView 组件卸载后异步搜索回调仍可能调用 `setResults`/`setLoading`
- 修改文件：`apps/rustplayer-tauri/frontend/src/views/SearchView.tsx`
- 策略：在 `useEffect` 中增加 `active` 标记或使用 `AbortController`
- 推迟原因：React 18+ 不再对此报错，当前有 `searchSeq` 竞态保护，实际影响极低

---

## P1 批次：流畅度与性能 ✅ 已完成 (2026-03-07)

> **实施摘要**：11 个文件修改，+151 / -86 行。Codex 审查通过（72→修复后），Gemini 审查因 API 503 跳过。
>
> **编译验证**：`cargo check` 通过，`npx tsc --noEmit` 通过，`cargo test -p rustplayer-qqmusic` 5/5 通过。

### P1-1. 频谱/播放引擎优化（#12 #13 #14 #15）

**#12 频谱"白算"** ✅
- 根因：后端 30fps 产出，事件层节流到 15fps，一半被丢弃
- 修改文件：`crates/player/src/lib.rs:327`, `events.rs:28`
- 实际方案：GStreamer spectrum `interval` 改为 66_666_667 (~15fps)；删除事件层 66ms 固定节流（last_spectrum_emit），改为直接转发

**#13 暂停时仍 33ms tick** ✅
- 根因：`player/lib.rs:96-113` 无论状态都固定 33ms tick
- 修改文件：`crates/player/src/lib.rs`
- 实际方案：命令处理后 + tick_progress 后均检查状态自适应 ticker（播放 33ms，其余 200ms）；Codex 审查修复：增加 tick_progress 后的 ticker 更新，覆盖 GStreamer bus 异步状态转换（Loading→Playing, Error→Stopped）

**#14 频谱 Vec 每帧分配** ✅（部分）
- 根因：`player/lib.rs:294-305` 每帧新建 Vec<f32>
- 修改文件：`crates/player/src/lib.rs`
- 实际方案：Engine 增加 `spectrum_buf: Vec<f32>` 预分配 buffer (capacity=64)；`extract_spectrum_into()` 写入预分配 buffer 避免 collect 开销。clone() 发送仍有 1 次已知大小分配（消除需改 broadcast channel 为 Arc<[f32]>，推迟到 P2）

**#15 PlayerState clone overhead** → 推迟到 P2
- 推迟原因：需修改公共 PlayerState 类型，影响前后端契约，风险过高

### P1-2. SQLite 缓存（#7 #8 #9 #10）

**#7 缺复合索引** ✅
- 修改文件：`apps/rustplayer-tauri/src-tauri/src/db.rs:42`
- 实际方案：新增复合索引 `idx_tracks_source_keyword ON tracks(source, search_keyword, cached_at)`

**#8 连接池过小** ✅
- 修改文件：`apps/rustplayer-tauri/src-tauri/src/db.rs`
- 实际方案：Pool max_size 8→12

**#9 blocking pool 排队** → 推迟到 P2
- 推迟原因：需要架构改造（异步 DB facade），P1 阶段过于复杂

**#10 N+1 INSERT** ✅
- 修改文件：`apps/rustplayer-tauri/src-tauri/src/db.rs`
- 实际方案：事务内使用 `prepare_cached()` + scoped statement 循环执行

### P1-3. 前端动画/GPU（#18 #19 #20 #21 #22）

**#18 SpectrumVisualizer 60fps + drop-shadow** ✅
- 修改文件：`SpectrumVisualizer.tsx`
- 实际方案：`filter: drop-shadow()` 替换为 Tailwind `shadow-[0_0_8px_var(--accent)]`（box-shadow，不依赖像素内容，无需每帧重计算）

**#19 Canvas 64 次 beginPath** ✅
- 修改文件：`SpectrumVisualizer.tsx:47-58`
- 实际方案：单次 beginPath + for 循环 roundRect + 单次 fill（从 64 次绘制调用减少到 1 次）

**#20 歌词页三重动画** → 推迟到三档帧率模式
- 推迟原因：需要完整的帧率检测和降级机制，与计划中的"三档帧率模式"功能合并实施

**#21 LyricsPanel 100+ 行 blur** ✅
- 修改文件：`LyricsPanel.tsx:148-175`
- 实际方案：blur 仅应用于活跃行±3行范围，其余行只使用 opacity（从 100+ 个 CSS blur 滤镜减少到最多 7 个）

**#22 ParticleSystem 120 粒子** ✅
- 修改文件：`ParticleSystem.tsx:22`
- 实际方案：MAX_PARTICLES 120→60

### P1-4. 网络客户端优化（#28 #29 #30 #31 #32）

**#28 HTTP 超时 5s 太短** ✅
- 修改文件：`netease/lib.rs:21`, `qqmusic/lib.rs:31`
- 实际方案：connect_timeout(3s) + timeout(10s)（TCP 快速失败，整体请求更宽容）

**#29 歌词重试固定 500ms** ✅
- 修改文件：`netease/api.rs:117`, `qqmusic/api.rs:215`
- 实际方案：固定 500ms 改为 150ms + rand jitter(0..150ms)，范围 150-300ms

**#30 QQ 音乐 JSON 克隆 + 双次 g_tk** ✅
- 修改文件：`qqmusic/api.rs:592-646`
- 实际方案：musicu_post 改为 `mut data: Value` 按值接收，直接原地修改，消除 `data.clone()`；6 个调用点同步更新

**#31 cookie 提取多次遍历** ✅
- 修改文件：`qqmusic/sign.rs` + `qqmusic/api.rs`
- 实际方案：新增 `CookieView<'a>` 结构体，单次遍历 cookie 解析 7 个字段（uin, skey, p_skey, qqmusic_key, login_type, p_lskey, lskey）；musicu_post 从 10+ 次 `extract_cookie_value` 调用改为 1 次 `CookieView::parse`

**#32 RwLock cookie 每次 clone** → 推迟到 P2
- 推迟原因：需修改 CookieStorage trait，影响 core crate + 两个音源 crate，跨模块改造推迟

### P1 审查结果汇总

| 审查方 | 评分 | 发现 | 处理 |
|--------|------|------|------|
| **Codex** | 72/100 | 2 Major + 2 Minor | Major#1（tick 异步状态切换）✅ 已修复；Major#2（spectrum clone 仍分配）已标注限制，推迟到 P2 |
| **Gemini** | N/A | API 503 | 跳过，前端改动由 Claude 自审 |

### P0+P1 综合审查修复 ✅ 已完成 (2026-03-07)

> **审查范围**：P0+P1 全部 3 次提交（20 文件，+752/-164 行）
> **审查方**：Codex 后端审查 + Gemini 前端审查（双模型并行）
> **修复摘要**：5 个文件修改，+34/-14 行。两轮 Codex 复查通过。
> **编译验证**：`cargo check` 通过，`npx tsc --noEmit` 通过。

#### 修复项

**审查修复 #1：PlaybackProgress 精确订阅** ✅
- 问题：`PlaybackProgress.tsx` 的 `usePlayerStore.subscribe()` 订阅整个 store，音量/队列等无关字段变化也会重置 RAF 插值锚点
- 修改文件：`PlaybackProgress.tsx`
- 实际方案：subscribe 改为 `(state, prevState)` 签名，仅当 `state/positionMs/durationMs/emittedAtMs` 四字段变化时才更新锚点

**审查修复 #2：emittedAtMs 漂移补偿闭环** ✅
- 问题：后端 `events.rs` 已附加 `emittedAtMs` 时间戳，但前端未消费，进度平滑链路不完整
- 修改文件：`playerStore.ts`, `App.tsx`, `PlaybackProgress.tsx`
- 实际方案：playerStore 新增 `emittedAtMs` 字段；App.tsx 透传；PlaybackProgress 仅当 `emittedAtMs` 实际变化时（即真实 progress 事件）才做 `Date.now() - emittedAtMs` 延迟补偿，本地状态变更（play/pause/seek）回退到 `performance.now()`
- 复查修正：首轮实现在暂停恢复/seek 后会误用旧时间戳导致瞬跳，二轮加入 `emittedAtMs !== prevState.emittedAtMs` 判断后修复

**审查修复 #3：spectrum 回调消除 slice 分配** ✅
- 问题：`App.tsx` 的 `onPlayerSpectrum` 中 `magnitudes.slice(0, arr.length)` 在高频回调产生 GC 压力
- 修改文件：`App.tsx`
- 实际方案：改为 for 循环逐元素写入 Float32Array + 零填充尾部，零中间分配

**审查修复 #4：移除 EVENT_EMIT_TIMEOUT 死代码** ✅
- 问题：`commands/mod.rs` 中 `EVENT_EMIT_TIMEOUT` 常量已无使用，产生 unused warning
- 修改文件：`commands/mod.rs`
- 实际方案：直接删除

**审查修复 #5：tokio interval MissedTickBehavior::Skip** ✅
- 问题：播放引擎 `tokio::time::interval` 使用默认 Burst 行为，极端卡顿后会补发大量 tick
- 修改文件：`crates/player/src/lib.rs`（3 处）
- 实际方案：初始化和 2 处 tick rate 自适应重建处均显式设 `MissedTickBehavior::Skip`

#### 综合审查修复结果

| 审查方 | 轮次 | 评分 | 状态 |
|--------|------|------|------|
| **Codex** | 首轮 | 75/100 | 发现 2 Major + 3 Minor |
| **Gemini** | 首轮 | 92/100 | PASS |
| **Codex** | 复查 R1 | 55/100 | emittedAtMs 实现有副作用 |
| **Codex** | 复查 R2 | 64/100 | emittedAtMs 修正通过，剩余建议推迟到 P2 |

### P1→P2 推迟项

- **#15**: PlayerState clone overhead → 需改公共类型
- **#9**: Blocking pool 异步 facade → 架构改造
- **#32**: RwLock cookie → Arc → 需改跨 crate trait
- **#14 完善**: spectrum clone 消除 → 需改 broadcast channel 为 Arc<[f32]>
- **#20**: 三重动画帧率检测 → 合并到三档帧率模式

### P1 审查→P2 推迟项（审查发现，推迟到 P2 处理）

#### P2-0a. progress 事件加 playSeq 防乱序（来自 Codex 复查 R2）

- 问题：seek/切歌后旧 progress 包可能迟到覆盖本地乐观状态，导致进度条瞬跳
- 修改文件：`crates/player/src/lib.rs`（发送端加 seq）、`events.rs`（透传）、`ipc.ts`（类型更新）、`playerStore.ts`（比较 seq 丢弃旧包）
- 策略：Engine 维护单调递增 `play_seq: u64`，每次 Load 时 +1；progress 事件携带 `play_seq`；前端 `updateProgress` 仅接受 `seq >= currentSeq` 的包
- 推迟原因：同机 Tauri IPC 延迟 <5ms，实际发生概率极低；需改后端事件类型 + 前端 store，影响面偏大
- 优先级：低（防御性增强）

#### P2-0b. CLAUDE.md 文档同步（来自 Codex 复查）

- 问题：`src-tauri/CLAUDE.md` 中 progress 事件仍写 `{ positionMs, durationMs }` 和 `~2Hz`
- 修改文件：`apps/rustplayer-tauri/src-tauri/CLAUDE.md`、`apps/rustplayer-tauri/frontend/CLAUDE.md`
- 策略：更新 progress 事件为 `{ positionMs, durationMs, emittedAtMs }`、频率为 `~5Hz`；更新 playerStore 字段列表
- 推迟原因：不影响运行，下次 `/ccg:init` 增量更新时一并处理

#### P2-0c. 进度插值/延迟补偿自动化测试（来自 Codex 复查）

- 问题：PlaybackProgress 的 RAF 插值、emittedAtMs 补偿、精确订阅逻辑无自动化测试
- 修改文件：新增 `frontend/src/components/player/__tests__/PlaybackProgress.test.ts`
- 策略：Vitest + fake timers 测试 4 个场景：正常插值、seek 后旧包丢弃、暂停恢复锚点正确、emittedAtMs 延迟补偿
- 推迟原因：需搭建 Vitest 测试基础设施（项目当前无前端测试），与整体测试策略统一规划

---

## P2 批次：资源效率与包体积

### P2-1. 前端资源优化（#33 #34 #35 #23）

**#33 Framer Motion ~70KB 仅用 3 处**
- 策略：替换为 CSS transitions + CSS animation

**#34 无路由级代码分割**
- 策略：React.lazy + Suspense 懒加载 SettingsView、PlaylistDetailView 等

**#35 CoverImage 无 loading="lazy"**
- 策略：添加 `loading="lazy"` + `decoding="async"`

**#23 PlayerBar Framer Motion layout**
- 策略：仅对简单位移使用 CSS transition，移除 layoutId morph

### P2-2. GStreamer 缓冲策略（#16）

**#16 管线缺 queue2 / BUFFERING**
- 修改文件：`crates/player/src/lib.rs:319-337`, `player/lib.rs:193`
- 策略：第一步在 uridecodebin 上启用 buffering 属性，bus 处理 Buffering 消息；第二步演进到 urisourcebin + queue2 + decodebin3
- 风险：状态机复杂化，本地文件和 HTTP 流要分流处理

### P2-3. CSS/GPU 开销（#38 #39 #40）

**#38 backdrop-filter blur(24px) × 3**
- 策略：降到 12px，或限制在顶层导航/固定底栏

**#39 text-gradient background-clip**
- 策略：限制在小字号元素上使用

**#40 16 个 gradient CSS 变量**
- 策略：按需加载或合并为动态生成

---

## P3 批次：长期健康

### P3-1. 前端杂项（#26 #27 #36 #37 #44 #45 #46）

**#26 playerStore 未拆分** → 按职责拆为 playback/queue/history 三个 store
**#27 PlaybackProgress DOM 操作** → 统一由 RAF 插值驱动，消除双路状态
**#36 useDynamicTheme LRU bug** → get 时将 key 移到 Map 末尾
**#37 HomeView stagger 重复动画** → 添加 mount flag 跳过二次动画
**#44 IPC 无重试** → 对 transient 错误加指数退避重试
**#45 事件监听器竞争** → 改用 AbortController 模式
**#46 StrictMode 重复监听** → useRef 确保单次绑定

### P3-2. IPC/跟踪层（#41 #42 #43）

**#41 run_with_trace span 开销** → 高频命令加 tracing fast-path
**#42 TraceId String 分配** → 前端已传 trace_id 时直接透传，未传时用整数字段
**#43 WebView cookie 轮询** → 改为导航/页载入事件触发的一次性探测，轮询仅作 fallback + 指数退避

---

---

## 新增功能：用户可选三档帧率模式

> 基于 Codex（后端）+ Gemini（前端）双模型专项分析，将原 #12/#13/#14/#18/#19/#20/#21/#22/#38 等固定优化方案升级为用户可控的三档模式。

### 设计原则

1. **帧率模式由后端播放器引擎统一持有**（单一事实源）
2. **GStreamer spectrum.interval 为唯一 FPS 控制点**，事件层退化为纯转发 + lag 保护
3. **前端通过 CSS 变量 + data 属性实现一次性分级联动**
4. **进度事件与视觉帧率弱联动**，前端本地插值补偿

### 三档特效参数总表

| 特效 | 低帧率 (15fps) 省电 | 中帧率 (30fps) 平衡 | 高帧率 (60fps) 全特效 |
|------|---------------------|---------------------|----------------------|
| **GStreamer interval** | 66.7ms | 33.3ms | 16.7ms |
| **事件层节流** | 移除固定节流，仅 lag 保护 | 同左 | 同左 |
| **Engine tick** | 66ms | 33ms | 16ms |
| **进度事件频率** | 250ms/次 | 150ms/次 | 100ms/次 |
| **频谱 Canvas 绘制** | fillRect 直角，无阴影 | roundRect，drop-shadow 半径减半 | roundRect + 全量 drop-shadow |
| **粒子系统** | 关闭 | 60 粒子 | 120 粒子 |
| **歌词非活跃行** | opacity-30，无 blur/scale | blur-sm + opacity-30 | blur-[1px] + opacity-30 + scale |
| **backdrop-filter** | 关闭，改 85% 不透明纯色 | blur(12px) | blur(24px) |
| **Framer Motion** | duration: 0（禁用） | 基础 opacity/y 位移 | 全量 layout + layoutId |
| **HomeView stagger** | 跳过 | 加速 | 全量 |

### 后端修改（Codex 方案）

**1. 新增类型定义** — `crates/core/src/lib.rs`
- 新增 `VisualFpsMode` 枚举：`Low(15) / Medium(30) / High(60)`
- `PlayerCommand` 新增 `SetVisualFpsMode(VisualFpsMode)`

**2. 播放器引擎适配** — `crates/player/src/lib.rs`
- `Engine` 新增字段：`visual_mode`、`spectrum_elem`（element 句柄）、`last_progress_emit: Instant`
- `build_pipeline()`：按模式设置 spectrum `interval`；返回 spectrum element 给 Engine 保存
- `handle_cmd()`：处理 `SetVisualFpsMode`，若 pipeline 存在则 `spectrum.set_property("interval", ...)`；否则仅更新内部模式
- `tick_progress()`：`progress_counter` 和 `state_mismatch_count` 从"按 tick 次数"改为"按时间阈值"
- tick 频率随模式调整：低 66ms、中 33ms、高 16ms
- GStreamer spectrum.interval 可运行时修改（Read/Write 属性），**无需重建管线**

**3. 事件层** — `apps/rustplayer-tauri/src-tauri/src/events.rs`
- 移除固定 66ms 节流，改为纯转发 + Lagged(n) lag 保护

**4. IPC Commands** — `apps/rustplayer-tauri/src-tauri/src/commands/mod.rs`
- 新增 `set_visual_fps_mode(mode, trace_id)` — 持久化 + 推送给播放器线程
- 新增 `get_visual_fps_mode(trace_id)` — 返回当前模式

**5. 持久化** — `apps/rustplayer-tauri/src-tauri/src/store.rs`
- 新增 store key `visual_fps_mode`
- `save_visual_fps_mode()` / `load_visual_fps_mode()`

**6. 应用入口** — `apps/rustplayer-tauri/src-tauri/src/main.rs`
- 注册新 commands
- setup 阶段读取 store 中的默认模式，初始化播放器时注入

### 前端修改（Gemini 方案）

**1. 新增 Store** — `src/store/performanceStore.ts`
```typescript
interface PerformanceStore {
  fpsMode: 15 | 30 | 60;
  reducedMotion: boolean;
  setFpsMode: (mode: 15 | 30 | 60) => void;
}
```
- `setFpsMode` 内部调用 `ipc.setVisualFpsMode(mode)` 同步后端

**2. 新增 Hook** — `src/hooks/useThrottledFrame.ts`
- 统一 RAF 控制器，仅用于无后端数据驱动的纯前端动画（粒子等）
- 后端驱动的频谱数据到达时直接绘制，不再二次节流

**3. 组件分级改造**

- `SpectrumVisualizer.tsx`：读取 `fpsMode`，切换绘制策略（fillRect/roundRect、shadow 开关）
- `ParticleSystem.tsx`：读取 `fpsMode`，调整粒子上限（0/60/120），低帧率直接不挂载
- `LyricsPanel.tsx`：读取 `fpsMode`，切换 blur/opacity/scale 策略
- `PlayerBar.tsx`：Framer Motion 按模式降级

**4. CSS 变量联动** — `theme.css` + `App.tsx`
- 根节点设置 `data-perf-mode="low|medium|high"` 属性
- CSS 变量 `--global-blur` 响应 perf mode
- `.glass` 类使用 `backdrop-filter: blur(var(--global-blur))`

**5. 设置 UI** — `SettingsView.tsx`
- Segmented Control 三档选择器（省电 / 平衡 / 高清）
- 即时生效，无需重启

### 风险与缓解

| 风险 | 严重度 | 缓解措施 |
|------|--------|---------|
| 60fps 下 IPC 序列化压力上升 | 中 | 保留 Lagged(n) 监控；考虑二进制序列化替代 JSON |
| 改 tick 频率但不改时间语义导致 progress/state 检测失真 | 高 | **必须先把所有"按 tick 次数"逻辑改为"按时间"** |
| 运行时改 spectrum.interval 在个别平台不一致 | 低 | 默认走动态更新；不稳定平台退化为下次 Load 生效 |
| 频段数量分级（32/64/128）需验证 GStreamer bands 运行时修改 | 中 | 初期不动频段数，统一 64 bands |

---

## 验证指标（每批次完成后必须度量）

| 指标 | 工具 | 目标 |
|------|------|------|
| 搜索 first-result p50/p95 | tracing span 时间 | p50 < 500ms, p95 < 1.5s |
| 总搜索 p95 | tracing | < 2s |
| DB pool wait | r2d2 metrics | < 10ms |
| L1/L2 cache hit ratio | 计数器 | > 60% |
| 播放线程 CPU（暂停态） | top/htop | < 1% |
| 频谱事件频率（按模式） | 计数器 | 15/30/60fps ±10% |
| 前端 FPS（歌词页，高帧率模式） | Chrome DevTools | > 55fps |
| 前端 FPS（歌词页，低帧率模式） | Chrome DevTools | CPU < 5% |
| 进度条视觉流畅度 | 主观评估 | 无可见跳动 |
| 首屏 JS bundle size | vite build | 减少 50KB+ |
| Buffering 次数/频率 | GStreamer bus 日志 | 弱网下 < 3 次/分钟 |
| 帧率切换延迟 | 手动测试 | < 200ms 生效 |
