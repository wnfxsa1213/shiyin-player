[根目录](../../CLAUDE.md) > [crates](../) > **player**

# crates/player - GStreamer 音频播放引擎

## 模块职责

封装 GStreamer 音频管线，提供异步命令/事件接口。播放引擎运行在独立线程，通过 tokio channel 与调用方通信。

## 入口与启动

- 入口文件：`src/lib.rs`
- `Player::new()` 创建实例，内部启动名为 `gstreamer-engine` 的独立线程

## 对外接口

- `Player::new()` -> `Result<Self, PlayerError>` - 初始化 GStreamer 并启动引擎线程
- `Player::subscribe()` -> `broadcast::Receiver<PlayerEvent>` - 订阅播放器事件
- `Player::send(cmd)` -> `Result<(), PlayerError>` - 发送播放命令

## 关键依赖与配置

- `gstreamer` 0.23 - 音频管线
- `tokio` - 异步运行时（channel + timer）
- `rustplayer-core` - 类型定义

## 内部架构

### GStreamer 管线

```
uridecodebin(url) -> audioconvert -> audioresample -> spectrum -> volume -> autoaudiosink
```

- `spectrum` 元素：64 频段，-80dB 阈值，~30fps 更新，输出归一化到 [0.0, 1.0]
- `uridecodebin` 使用动态 pad 连接

### 引擎循环

- 33ms ticker 轮询 GStreamer bus（EOS / Error / StateChanged / Spectrum）
- 进度事件约 2Hz 发送（每 15 个 tick）
- 命令处理：Load / Play / Pause / Toggle / Stop / Seek / SetVolume

### 状态机

```
Idle -> Loading -> Playing <-> Paused -> Stopped
                     |                      ^
                   Error -------------------+
```

## 数据模型

无独立数据模型，使用 `rustplayer-core` 中的 PlayerState / PlayerCommand / PlayerEvent。

## 测试与质量

当前无测试文件。建议测试方向：状态机转移逻辑、命令处理边界条件。

## 相关文件清单

- `src/lib.rs` - 播放引擎完整实现（324 行）

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |
