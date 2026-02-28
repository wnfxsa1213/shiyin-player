# 修复 Critical & Major 代码审查问题 — WBS 实施计划

**规划时间**：2026-02-25 | **预估工作量**：48 任务点

## 1. 概述
修复 4 Critical + 9 Major 共 13 项问题。约束：Rust+Tauri v2, React 18+TS, 最小侵入性。

## 2. Phase 1: Critical（15 点）

### C1: Cookie 凭据加密存储（5 点）
- [ ] **C1.1** keyring 替代明文（3 点） — `src-tauri/Cargo.toml` + `src/store.rs`
  - 添加 `keyring = "3"`，重写 save/load/delete_cookie 用系统密钥链
- [ ] **C1.2** 迁移旧明文 + 回退（2 点） — `src/store.rs` + `src/main.rs`
  - 新增 migrate_from_plaintext，keyring 不可用时回退 tauri-plugin-store

### C2: logout 清理内存态会话（3 点）
- [ ] **C2.1** trait 新增 logout（1 点） — `crates/core/src/lib.rs`
- [ ] **C2.2** Client 实现 logout（1 点） — `netease/lib.rs` + `qqmusic/lib.rs`
- [ ] **C2.3** command 调用 logout（1 点） — `commands/mod.rs`

### C3: Tauri CSP 收紧（3 点）
- [ ] **C3.1** 启用 CSP（1 点） — `tauri.conf.json`
- [ ] **C3.2** 关闭 withGlobalTauri（1 点） — `tauri.conf.json`
- [ ] **C3.3** 最小化 capabilities（1 点） — `capabilities/default.json`

### C4: 搜索并发化（4 点）
- [ ] **C4.1** search_music 改 join_all（3 点） — `commands/mod.rs`
- [ ] **C4.2** get_user_playlists 同样并发（1 点） — `commands/mod.rs`

## 3. Phase 2: Major 后端（12 点）

### M1: 频谱节流（3 点）
- [ ] **M1.1** events.rs 频谱节流至 ~15fps（2 点） — `events.rs`
- [ ] **M1.2** 前端可视化关闭时跳过监听（1 点） — `App.tsx`

### M2: 结构化错误（3 点）
- [ ] **M2.1** 定义 IpcError 枚举（2 点） — `commands/mod.rs`
- [ ] **M2.2** 前端适配结构化错误（1 点） — `lib/ipc.ts`

### M3: 缓存容错（1 点）
- [ ] **M3.1** spawn_blocking 添加错误日志（1 点） — `commands/mod.rs`

### M4: SQLite 连接池（5 点）
- [ ] **M4.1** r2d2-sqlite 连接池（3 点） — `Cargo.toml` + `db.rs`
- [ ] **M4.2** 启用 WAL 模式（1 点） — `db.rs`
- [ ] **M4.3** 定时清理替代查询时清理（1 点） — `db.rs` + `main.rs`

## 4. Phase 3: Major 前端（21 点）

### M5: 播放竞态（3 点）
- [ ] **M5.1** 添加播放请求序列号（2 点） — `playerStore.ts`
  - store 外部 `let playSeq = 0`，catch 中检查 seq 是否过期
- [ ] **M5.2** 仅当 seq 匹配时回滚状态（1 点） — `playerStore.ts`

### M6: 搜索取消（3 点）
- [ ] **M6.1** 请求序列号取消机制（2 点） — `SearchView.tsx`
- [ ] **M6.2** loading 状态防重复（1 点） — `SearchView.tsx`

### M7: 错误脱敏（3 点）
- [ ] **M7.1** 创建 sanitizeError 工具（2 点） — 新建 `lib/errorMessages.ts`
- [ ] **M7.2** 替换所有透传点（1 点） — `App.tsx` + `SettingsView.tsx` + `ErrorBoundary.tsx`

### M8: 焦点陷阱（4 点）
- [ ] **M8.1** useFocusTrap hook（2 点） — 新建 `hooks/useFocusTrap.ts`
- [ ] **M8.2** QueuePanel 集成（1 点） — `QueuePanel.tsx`
- [ ] **M8.3** LyricsPanel 集成（1 点） — `LyricsPanel.tsx`

### M9: focus-visible 样式（5 点）
- [ ] **M9.1** 全局 focus-visible 基础样式（1 点） — `styles/theme.css`
- [ ] **M9.2** HomeView 卡片按钮（1 点） — `HomeView.tsx`
- [ ] **M9.3** SettingsView 开关/模式按钮（1 点） — `SettingsView.tsx`
- [ ] **M9.4** QueuePanel 交互元素（1 点） — `QueuePanel.tsx`
- [ ] **M9.5** 全局审查其他交互元素（1 点） — `PlayerBar.tsx` + `Sidebar.tsx`

## 5. 依赖关系

| 任务 | 依赖于 | 原因 |
|------|--------|------|
| C1.2 | C1.1 | 迁移依赖 keyring 就绪 |
| C2.2 | C2.1 | Client 实现依赖 trait 定义 |
| C2.3 | C2.2 | command 依赖 Client 实现 |
| C3.3 | C1.1 | 是否移除 store 权限取决于 keyring |
| M2.2 | M2.1 | 前端适配依赖后端错误结构 |
| M7.1 | M2.2 | 错误映射依赖结构化错误类型 |
| M8.2/M8.3 | M8.1 | 面板集成依赖 hook |
| M9.2-M9.5 | M9.1 | 组件样式依赖全局规则 |

**可并行组**：C1 ∥ C2 ∥ C3 ∥ C4 | M1 ∥ M3 ∥ M4 | M5 ∥ M6 ∥ M8 ∥ M9 | Phase 2 ∥ Phase 3
