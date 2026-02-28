# 修复 15 项 Minor 代码审查问题 — WBS 实施计划

**规划时间**：2026-02-25 | **已修复**：m9（contentEditable 排除）| **实际待修**：14 项

## 1. 概述

修复代码审查中 15 项 Minor 问题（m9 已在上轮修复）。全部为小改动，无架构变更。

## 2. Phase 1: 后端 Rust（6 项）

### m1: HTTP 客户端构造失败直接 panic（2 处）
- **文件**：`crates/netease/src/lib.rs:27` + `crates/qqmusic/src/lib.rs:27`
- **现状**：`.expect("failed to build http client")` 在构造函数中 panic
- **修复**：`new()` 改为 `new() -> Result<Self, SourceError>`，调用方在 `main.rs:29-30` 用 `unwrap_or_else` 处理
- **注意**：`SourceRegistry::register` 接收 `Arc<dyn MusicSource>`，需在 register 前处理 Result

### m2: 播放器 Drop 未 join 引擎线程
- **文件**：`crates/player/src/lib.rs:45-50`
- **现状**：Drop impl 为空注释，`_thread: JoinHandle<()>` 未 join
- **修复**：Drop 中 `drop(self.cmd_tx)` 关闭 channel（已隐式），然后将 `_thread` 改为 `Option<JoinHandle<()>>`，Drop 中 `self._thread.take().map(|h| h.join())`
- **注意**：需将 `_thread` 改为 `thread: Option<JoinHandle<()>>`

### m3: 缓存查询无 ORDER BY
- **文件**：`apps/rustplayer-tauri/src-tauri/src/db.rs` get_cached_tracks
- **修复**：SELECT 语句末尾添加 `ORDER BY rowid`，保持插入顺序

### m4: weapi_post 先反序列化再判 HTTP 状态
- **文件**：`crates/netease/src/api.rs:97-101`
- **现状**：先 `res.json().await`（L99），再检查 `status.is_success()`（L100）
- **修复**：调换顺序 — 先判 status，非 2xx 时用 `res.text().await` 取 body 作为错误信息

### m14: 网易歌单详情 n=100000 过大
- **文件**：`crates/netease/src/api.rs:173`
- **现状**：`"n": 100000` 一次请求所有曲目
- **修复**：改为 `"n": 1000`（合理上限），超大歌单分页留后续优化

### m15: 7 天缓存 TTL 过长
- **文件**：`apps/rustplayer-tauri/src-tauri/src/db.rs:6`
- **修复**：`CACHE_TTL_SECS` 从 7 天改为 1 天（`24 * 3600`），搜索结果时效性更好
## 3. Phase 2: 前端 TypeScript（8 项）

### m5: ipc.ts 中 `as any` 类型断言
- **文件**：`apps/rustplayer-tauri/frontend/src/lib/ipc.ts`
- **现状**：经检查，当前 ipc.ts 无 `as any`，此项已不存在
- **处理**：跳过（无需修改）

### m6: IPC 类型宽泛（source 参数为 string）
- **文件**：`apps/rustplayer-tauri/frontend/src/lib/ipc.ts`
- **现状**：`login`、`logout`、`getLyrics`、`getPlaylistDetail` 的 source 参数为 `string`
- **修复**：定义 `type MusicSource = 'netease' | 'qqmusic'`，替换相关函数签名中的 `string` 为 `MusicSource`
- **注意**：`searchMusic` 的 source 可选且含 `undefined`（全部搜索），保持 `source?: MusicSource`

### m7: Toast setTimeout 无清理
- **文件**：`apps/rustplayer-tauri/frontend/src/store/toastStore.ts`
- **现状**：`setTimeout` 返回值未保存，Toast 被手动 removeToast 后定时器仍会触发（无害但不干净）
- **修复**：在 Toast 接口中添加 `timerId?: ReturnType<typeof setTimeout>`，addToast 时保存 timerId，removeToast 时 `clearTimeout(timerId)`

### m8: 封面 URL 未校验协议
- **文件**：多处使用 `track.coverUrl` 的组件
- **现状**：coverUrl 直接传入 `<img src=>`，若含非 http/https 协议可能有安全风险
- **修复**：在 `ipc.ts` 中添加 `sanitizeCoverUrl(url?: string): string | undefined` 工具函数，仅允许 `http://`、`https://`、`data:image/` 开头的 URL，否则返回 undefined
- **注意**：在 ipc 层的返回数据处理中统一过滤，不需要改动每个组件

### m10: 骨架屏缺少 aria-busy
- **文件**：`SearchView.tsx:71-84` + `PlaylistDetailView.tsx:48-57`
- **现状**：加载骨架屏 `animate-pulse` 容器无 `aria-busy="true"`
- **修复**：在骨架屏外层 div 添加 `aria-busy="true"` 和 `role="status"`

### m11: Canvas 缺少 aria-hidden
- **文件**：`apps/rustplayer-tauri/frontend/src/components/player/SpectrumVisualizer.tsx:72-78`
- **现状**：`<canvas>` 元素无 `aria-hidden="true"`，屏幕阅读器会尝试读取
- **修复**：添加 `aria-hidden="true"` 和 `role="img"`

### m12: 搜索输入框 type="text" 应为 type="search"
- **文件**：`apps/rustplayer-tauri/frontend/src/views/SearchView.tsx:44`
- **现状**：`type="text"`
- **修复**：改为 `type="search"`，浏览器会提供清除按钮和语义化

### m13: 歌单封面 alt 为空
- **文件**：`apps/rustplayer-tauri/frontend/src/views/PlaylistDetailView.tsx:64`
- **现状**：`alt=""`
- **修复**：改为 `alt={playlist.name + ' 封面'}` 提供有意义的替代文本

## 4. 实施策略

- **Phase 1（后端）**：串行修改 6 个 Rust 文件，每项改动独立，互不影响
- **Phase 2（前端）**：串行修改 7 个 TS/TSX 文件（m5 跳过），改动均为局部
- **验证**：Phase 1 完成后 `cargo check`，Phase 2 完成后 `npx tsc --noEmit`
- **风险**：m1 改变 `new()` 签名需同步 main.rs 调用方，m2 改变 Player 字段类型需确认线程安全
