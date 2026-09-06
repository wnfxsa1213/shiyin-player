[根目录](../../CLAUDE.md) > [crates](../) > **player**

# crates/player - GStreamer 音频播放引擎

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-03-15T11:22:14 | 校验 | 无代码变更，确认文档仍准确 |
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |

## 模块职责

封装 GStreamer 音频管线，提供异步命令/事件接口。播放引擎运行在独立线程，通过 tokio channel 与调用方通信。

## 入口与启动

- 入口文件：`src/lib.rs`
- `Player::new()` 创建实例，内部启动名为 `gstreamer-engine` 的独立线程

## 对外接口

- `Player::new()` -> `Result<Self, PlayerError>` - 初始化 GStreamer 并启动引擎线程
- `Player::subscribe()` -> `broadcast::Receiver<PlayerEvent>` - 订阅播放器事件
- `Player::reserve_request(id)` 在流地址解析前登记递增请求，`is_current_request(id)` 检查解析结果是否仍有效
- `Player::send(cmd)` - 加载入队后返回，加载失败经事件报告；其他控制命令等待执行结果，失败经返回值报告
- 订阅返回 `PlayerEventEnvelope`，包含 `playback_id` 与事件；`Ended` 独立表示自然结束

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
- 命令处理：Load / SetPaused / Stop / Seek / SetVolume；加载、暂停、停止与跳转都携带播放标识
- 加载先 preroll，再恢复起始位置并应用播放意图；新管线继承音量
- 修改标识过滤、初始 seek 或结束行为时，先读 `docs/design/playback-lifecycle.md`，并运行本 crate 的真实管线测试

### 状态机

```
Idle -> Loading -> Playing <-> Paused -> Stopped
                     |                      ^
                   Error -------------------+
```

## 数据模型

无独立数据模型，使用 `rustplayer-core` 中的 PlayerState / PlayerCommand / PlayerEvent。

## 测试与质量

`cargo test -p rustplayer-player` 使用本地 WAV 与 `fakesink`，验证迟到加载、旧控制、断点恢复和真实自然结束；测试不要求声卡。

## 相关文件清单

- `src/lib.rs` - 播放引擎完整实现
