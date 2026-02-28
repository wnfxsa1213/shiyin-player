# 修复审计问题 — 实施计划

**规划时间**：2026-02-25 | **任务类型**：全栈（Rust + TypeScript）

## 概述

修复代码审查中发现的 1 项 Critical + 4 项 Major + 4 项 Minor 问题。

## Phase 1: 后端 Rust（5 项）

### C1: client_log 添加消息长度截断和速率限制 [Critical]
- **文件**：`apps/rustplayer-tauri/src-tauri/src/commands/mod.rs`
- **修复**：截断 message 至 16KB，添加基于时间窗口的简单速率限制（每分钟最多 60 条）

### M1: get_user_playlists 保留 SourceError 语义 [Major]
- **文件**：`apps/rustplayer-tauri/src-tauri/src/commands/mod.rs`
- **修复**：参照 search_music 实现，保留 SourceError 类型映射到对应 IpcError

### M3: 日志添加保留天数限制 [Major]
- **文件**：`apps/rustplayer-tauri/src-tauri/src/logging.rs`
- **修复**：启动时清理超过 7 天的日志文件

### m1: Player Drop 添加超时 join [Minor]
- **文件**：`crates/player/src/lib.rs`
- **修复**：使用 spawn + recv_timeout 替代直接 join，超时 3 秒后放弃

### m2: CSP 区分 dev/release [Minor]
- **文件**：`apps/rustplayer-tauri/src-tauri/tauri.conf.json`
- **修复**：connect-src 添加 ws://localhost:* 用于 dev HMR

## Phase 2: 前端 TypeScript（4 项）

### M2: sanitizeError release 模式隐藏后端 detail [Major]
- **文件**：`apps/rustplayer-tauri/frontend/src/lib/errorMessages.ts`
- **修复**：network/internal 类型在 release 下只展示固定文案，不拼接 detail

### M4: 图片 onError 触发状态更新渲染占位图标 [Major]
- **文件**：HomeView.tsx、PlaylistDetailView.tsx、PlayerBar.tsx、LyricsPanel.tsx
- **修复**：onError 时更新 state 触发 fallback 渲染

### m3: 搜索输入框添加 aria-label [Minor]
- **文件**：`apps/rustplayer-tauri/frontend/src/views/SearchView.tsx`
- **修复**：添加 `aria-label="搜索音乐"`

### m4: 全局错误监听使用 instanceof Error [Minor]
- **文件**：`apps/rustplayer-tauri/frontend/src/App.tsx`
- **修复**：替换 `(e.error as any).stack` 为 `e.error instanceof Error ? e.error.stack : ''`
