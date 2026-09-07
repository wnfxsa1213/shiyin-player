# 测试建议文档

本文档记录了代码审查中发现的关键修复点，以及建议的测试覆盖方向。

## 已有的音乐发现回归测试

在项目根目录运行：

```bash
cargo test -p rustplayer-recommend -p rustplayer-tauri
npm --prefix apps/rustplayer-tauri/frontend test
npm --prefix apps/rustplayer-tauri/frontend run build
```

- 后端测试覆盖正常空结果、部分音源失败且无候选歌曲，以及队列排除后的失败状态。
- 前端测试位于 `apps/rustplayer-tauri/frontend/tests/musicDiscovery.test.tsx`，使用 Vitest、React Testing Library 和 jsdom，模拟 Tauri IPC，执行真实页面和 Zustand store。
- 前端回归覆盖空结果与仅有重温经典时的手动刷新、不可用结果的重试入口，以及 FM 播放和自动补曲共享降级通知去重、恢复后再次提示。

## 首页、导航与搜索反馈回归

运行 `npm --prefix apps/rustplayer-tauri/frontend test`、`npm --prefix apps/rustplayer-tauri/frontend run build` 和 `cargo test --workspace --locked --offline`。

- `homeNavigation.test.tsx`：8 项，覆盖歌单集合与焦点、具体歌单去向、真实推荐、播放详情保留队列、未登录、登录检查失败、歌单/推荐空结果与重试、推荐降级与重温经典。
- `searchFeedback.test.tsx`：12 项，覆盖防抖、Enter、中文组合输入、音源键盘操作、迟到成功/失败、旧结果的上下文与播放、清空和页面隔离；运行真实页面、Hook、虚拟列表和播放 store，仅模拟 IPC 与 jsdom 缺少的布局 API。
- `musicDiscovery.test.tsx` 追加 2 项：失败后等待用户重试，未登录时不显示缓存推荐。

本轮全部前端回归共 105 项，Rust 共 52 项。真实浏览器的窗口/主题矩阵、截图及边界见 [首页与搜索验证](docs/design/home-navigation-search-validation.md)。

## 播放生命周期回归测试

```bash
cargo test --workspace
npm --prefix apps/rustplayer-tauri/frontend test
```

- `frontend/tests/playbackLifecycle.test.ts` 通过生命周期 interface 覆盖请求竞态、引擎接管前后的回滚、重试预算、自然结束、单曲循环、暂停/跳转、行为计时和队列失效；包含迟到接管在失败回滚前后保留暂停，以及顺序/随机模式下迟到补曲不扩大失败轮次、手动播放恢复补曲。
- `crates/player/src/lib.rs` 使用本地 WAV 和 GStreamer `fakesink` 验证请求代次、旧控制隔离、暂停加载、断点恢复与真实结束事件；通过控制真实管线完成事件的处理顺序，验证恢复期间跳回 0 秒覆盖原始进度，不依赖音源账号或声卡。
- `crates/core/src/lib.rs` 验证播放命令与事件信封的 camelCase 字段序列化和反序列化。
- `src-tauri/src/events.rs` 验证前后端事件字段与自然结束/普通停止的区别。

## 播放主流程 UI 回归

运行前端 `npm test`、`npm run build` 与 `cargo test --workspace --locked --offline`。`playbackUi.test.tsx` 使用真实组件、生命周期与虚拟列表，仅模拟 IPC 和 jsdom 缺少的尺寸、滚动事实；覆盖单曲保留队列、加载/缓冲暂停、失败回滚后的重试入口、歌曲菜单、虚拟队列跨屏焦点与清空确认。生命周期测试补充整单替换竞态、去重与指定下一首优先、同曲失败后明确重试；进度测试覆盖禁用与可读时间。

2026-09-06 的界面验收和范围见 [播放主流程 UI 验证](docs/design/playback-ui-validation.md)。后续压力测试按当前安排暂停。

UI 分支评审后，前端回归为 79 项。新增沉浸指定下一首与队列保留、待播放队列启动、非模态队列关闭不抢焦点，以及隐藏/加载后迟到频谱过滤；场景页面测试补充歌词预览断言。修复前复现、Chromium / WebKitGTK 操作与窗口覆盖见 [评审收尾](docs/design/ui-branch-review.md)。

## 视觉场景回归

运行前端 `npm test` 与 `npm run build`，以及 Rust `cargo test --workspace`。当前已缓存环境可附加 `--locked --offline`。场景测试通过工厂接口、真实页面和可控时钟覆盖草稿隔离、应用竞态、持久化顺序、素材引用、取消解码、轮换与窗口恢复；进度条测试验证隐藏/暂停停帧及取消拖动。后端覆盖导入格式、尺寸、去重、失败清理、受限资源读取和频谱字段。

真实 Tauri、WebKitGTK 与深浅主题检查方法、结果和设备范围见 [视觉场景验证记录](docs/design/visual-scenes-validation.md)。新增效果或改变画质预算时，同时检查背景帧时长与交互响应；场景单位测试不能替代该检查。

`scenePreview.test.tsx` 运行真实场景页面、Surface 和渲染器，仅补齐 jsdom 缺少的 Canvas / 观察器 API 和可控帧时钟。覆盖未播放与暂停时展开预览仍连续绘制、被覆盖的小预览停绘、退出恢复、隐藏/减少动态效果/粒子开关，以及正式播放背景仍按播放状态停绘。

## 后端测试建议 (Rust)

### 1. QQ 音乐 API 错误处理 (`crates/qqmusic/src/api.rs`)

#### 测试用例 1: 未知 midurlinfo 错误码返回 Internal
```rust
#[tokio::test]
async fn test_unknown_midurlinfo_result_returns_internal_error() {
    // Given: midurlinfo 包含 result=999 (未知错误码)
    // When: 调用 song_url
    // Then: 应返回 SourceError::Internal("midurlinfo result=999")
    //       而不是 SourceError::NotFound
}
```

#### 测试用例 2: 歌词业务错误不重试
```rust
#[tokio::test]
async fn test_lyrics_business_error_no_retry() {
    // Given: API 返回 code=-1310 (缺少 referer/鉴权)
    // When: 调用 lyrics
    // Then: 应立即返回 SourceError::Unauthorized
    //       不应重试第二个音源（避免 ~500ms 延迟）
}
```

#### 测试用例 3: req.code 非零早退
```rust
#[tokio::test]
async fn test_req_code_nonzero_early_return() {
    // Given: vkey API 返回 req.code=500
    // When: 调用 song_url
    // Then: 应返回 SourceError::Internal("vkey req.code=500")
    //       不应继续检查 midurlinfo
}
```

#### 测试用例 4: 错误优先级聚合
```rust
#[tokio::test]
async fn test_priority_payment_over_unauthorized() {
    // Given: midurlinfo 包含 [result=104003, result=-100, result=0]
    // When: 调用 song_url
    // Then: 应返回 SourceError::PaymentRequired
    //       (而不是 Unauthorized，即使它出现在后面)
}
```

### 2. 数据库迁移 (`apps/rustplayer-tauri/src-tauri/src/db.rs`)

#### 测试用例 5: PRAGMA 查询失败显式报错
```rust
#[test]
fn test_schema_check_failure_aborts_init() {
    // Given: PRAGMA table_info 查询失败
    // When: 初始化数据库
    // Then: 应返回错误并中止初始化
    //       不应静默退化（unwrap_or）
}
```

## 前端测试建议 (TypeScript/React)

### 3. 播放器状态回滚 (`frontend/src/store/playerStore.ts`)

#### 测试用例 6: 快速连续点击不回滚新请求
```typescript
it('should not rollback if a newer play request has been made', async () => {
  // Given: 快速点击 A -> B -> C，B 失败
  // When: B 的错误处理执行
  // Then: 当前曲目应为 C，不应回滚到 A
  //       (因为 C 的 playSeq 更新，B 的回滚被跳过)
});
```

#### 测试用例 7: 最新请求失败时正确回滚
```typescript
it('should rollback if the failed request is still the most recent', async () => {
  // Given: 播放 B 失败，且没有更新的请求
  // When: B 的错误处理执行
  // Then: 应回滚到之前的曲目 A
});
```

#### 测试用例 8: playSeq 隔离性
```typescript
it('should maintain playSeq within store state', () => {
  // Given: 创建新的 store 实例
  // Then: playSeq 应是 store 状态的一部分
  //       不应是全局变量
});
```

#### 测试用例 9: clearQueue 增加 playSeq
```typescript
it('should increment playSeq on clearQueue', () => {
  // Given: 当前 playSeq = N
  // When: 调用 clearQueue
  // Then: playSeq 应变为 N+1
  //       (防止清空前的播放请求影响清空后的状态)
});
```

### 4. 错误提示 (`frontend/src/store/playerStore.ts`)

#### 测试用例 10: repeat-one 模式错误提示
```typescript
it('should show toast on repeat-one seek/toggle error', async () => {
  // Given: repeat-one 模式，seek 或 togglePlayback 失败
  // When: playNext/playPrev 被调用
  // Then: 应显示 toast 错误提示
  //       不应只 console.error
});
```

### 5. 无障碍性 (`frontend/src/App.tsx`)

#### 测试用例 11: ARIA live region 播放状态通知
```typescript
it('should announce playback state changes to screen readers', () => {
  // Given: 播放状态从 paused 变为 playing
  // When: onPlayerState 事件触发
  // Then: #player-status-announcer 应更新文本
  //       屏幕阅读器用户应收到通知
});
```

## 测试工具建议

### Rust 后端
- 使用 `wiremock` 模拟 HTTP 响应
- 使用 `tokio::test` 进行异步测试
- 使用 `tempfile` 创建临时数据库

### TypeScript 前端
- 使用 `vitest` 作为测试运行器
- 使用 `@testing-library/react` 测试组件
- 使用 `vi.mock` 模拟 IPC 调用

## 安装测试依赖

### 前端
```bash
cd apps/rustplayer-tauri/frontend
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

### 后端
```toml
[dev-dependencies]
wiremock = "0.6"
tempfile = "3.8"
```

## 运行测试

### 前端
```bash
cd apps/rustplayer-tauri/frontend
npm run test
```

### 后端
```bash
cargo test --package rustplayer-qqmusic
cargo test --package rustplayer-tauri
```

## 测试覆盖率目标

- **关键路径**: 100% (错误处理、状态回滚)
- **业务逻辑**: 80%+
- **UI 组件**: 60%+

## 参考文件

- 后端测试位置（计划中）: `crates/qqmusic/tests/api_test.rs`
- 前端测试位置（计划中）: `apps/rustplayer-tauri/frontend/src/store/__tests__/playerStore.test.ts`
