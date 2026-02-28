[根目录](../../CLAUDE.md) > [crates](../) > **core**

# crates/core - 核心类型定义

## 模块职责

定义整个项目共享的数据类型、trait 接口和错误类型。所有其他 crate 都依赖此模块。

## 入口与启动

- 入口文件：`src/lib.rs`
- 纯类型库，无运行时入口

## 对外接口

### 核心数据类型

- `Track` - 歌曲元数据（id, name, artist, album, duration_ms, source, cover_url）
- `StreamInfo` - 音频流信息（url, format, bitrate）
- `LyricsLine` - 歌词行（time_ms, text, translation）
- `PlaylistBrief` / `Playlist` - 歌单摘要与详情
- `SearchQuery` - 搜索参数（keyword, limit, offset）
- `Credentials` / `AuthToken` - 认证凭据与令牌
- `MusicSourceId` - 音源枚举（Netease, Qqmusic）

### 状态与命令

- `PlayerState` - 播放器状态机（Idle / Loading / Playing / Paused / Stopped）
- `PlayerCommand` - 播放器命令（Load / Play / Pause / Toggle / Stop / Seek / SetVolume）
- `PlayerEvent` - 播放器事件（StateChanged / Progress / Spectrum / Error）

### Trait

- `MusicSource` - 音乐源插件接口，定义 search / get_stream_url / get_lyrics / get_album_art / login / get_user_playlists / get_playlist_detail

### 错误类型

- `SourceError` - 音源错误（Network / Unauthorized / NotFound / RateLimited / InvalidResponse / Unimplemented / Internal）
- `PlayerError` - 播放器错误（InvalidState / Pipeline / Stream / ChannelClosed / Internal）
- `AppError` - 应用顶层错误（Source / Player / InvalidInput / Internal）

## 关键依赖与配置

- `serde` + `serde_json` - 序列化（camelCase 风格）
- `async-trait` - 异步 trait 支持
- `thiserror` - 错误类型派生

## 数据模型

所有类型均使用 `#[derive(Serialize, Deserialize)]` 并采用 `camelCase` 序列化，与前端 TypeScript 类型对齐。

## 测试与质量

当前无测试文件。

## 相关文件清单

- `src/lib.rs` - 全部类型定义（176 行）

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |
