# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-03-16 | auto | feat(home) | 首页电台入口绑定沉浸 FM | 复用 uiStore.setImmersiveOpen | — | low |
| 2026-03-16 | 8e974cd4 | fix(immersive) | 沉浸 FM 不再触发原生全屏 | CSS fixed inset-0 足够覆盖窗口，无需 setFullscreen | 点击沉浸FM自动全屏 → 移除 setFullscreen useEffect | low |
