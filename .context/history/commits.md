# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-03-16 | auto | feat(home) | 首页电台入口绑定沉浸 FM | 复用 uiStore.setImmersiveOpen | — | low |
| 2026-03-16 | 8e974cd4 | fix(immersive) | 沉浸 FM 不再触发原生全屏 | CSS fixed inset-0 足够覆盖窗口，无需 setFullscreen | 点击沉浸FM自动全屏 → 移除 setFullscreen useEffect | low |
| 2026-03-16 | bf3a91e7 | feat(player) | 缓冲状态感知 + 播放失败自动重试 | 新增 Buffering 状态贯穿全栈；缓冲区扩大到 8MB/10s；30s 超时 teardown；前端重试 2 次从断点恢复；进度条冻结插值 | — | medium |
