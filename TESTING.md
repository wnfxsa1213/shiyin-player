# 测试建议文档

本文档记录了代码审查中发现的关键修复点，以及建议的测试覆盖方向。

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
