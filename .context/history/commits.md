# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-03-16 | auto | feat(home) | 首页电台入口绑定沉浸 FM | 复用 uiStore.setImmersiveOpen | — | low |
| 2026-03-16 | 8e974cd4 | fix(immersive) | 沉浸 FM 不再触发原生全屏 | CSS fixed inset-0 足够覆盖窗口，无需 setFullscreen | 点击沉浸FM自动全屏 → 移除 setFullscreen useEffect | low |
| 2026-03-16 | bf3a91e7 | feat(player) | 缓冲状态感知 + 播放失败自动重试 | 新增 Buffering 状态贯穿全栈；缓冲区扩大到 8MB/10s；30s 超时 teardown；前端重试 2 次从断点恢复；进度条冻结插值 | — | medium |
| 2026-09-06 | ui-review-20260906 | fix(ui) | UI 分支评审收尾，5 项问题修复 | 统一沉浸控制、共享预览布局、统一频谱条件、按归属恢复焦点 | 沉浸误清队列/无法启动、预览缺歌词、焦点抢回、迟到频谱 | low |
| 2026-09-06 | preview-motion-20260906 | fix(scenes) | 恢复未播放/暂停时的沉浸预览动画 | 分离 variant 外观与 motion 调度 | 展开预览只绘制一帧 | low |
| 2026-09-06 | home-navigation-search-20260906 | feat(ui) | 首页、导航与搜索反馈 | 歌单集合与真实推荐；播放详情名称统一；搜索状态与上次结果携带上下文 | 搜索失败/迟到响应与推荐失败循环 | low |
