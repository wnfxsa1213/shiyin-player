[根目录](../../CLAUDE.md) > [crates](../) > **netease**

# crates/netease - 网易云音乐 API 客户端

## 模块职责

实现网易云音乐 (music.163.com) 的 API 客户端，包括 weapi 加密、搜索、播放地址获取、歌词、歌单等功能。实现了 `MusicSource` trait。

## 入口与启动

- 入口文件：`src/lib.rs`
- `NeteaseClient::new()` 创建客户端实例（内置 reqwest HTTP client，5s 超时，cookie jar）

## 对外接口

`NeteaseClient` 实现 `MusicSource` trait：

- `search(query)` - 搜索歌曲
- `get_stream_url(track_id)` - 获取音频流 URL（支持 flac/exhigh 品质）
- `get_lyrics(track_id)` - 获取歌词（支持原文 + 翻译）
- `get_album_art(track_id)` - 获取专辑封面 URL
- `login(credentials)` - Cookie 方式登录
- `get_user_playlists()` - 获取用户歌单列表
- `get_playlist_detail(id)` - 获取歌单详情及曲目

### 内部 API 端点

- `POST /weapi/search/get` - 搜索
- `POST /weapi/song/enhance/player/url/v1` - 播放地址
- `GET /api/song/lyric` - 歌词
- `POST /weapi/w/nuser/account/get` - 获取用户 UID
- `POST /weapi/user/playlist` - 用户歌单
- `POST /weapi/v6/playlist/detail` - 歌单详情

## 关键依赖与配置

- `reqwest` 0.12 (rustls-tls, json, cookies) - HTTP 客户端
- `aes` 0.8 + `cbc` 0.1 - AES-128-CBC 加密
- `rsa` 0.9 + `base64` 0.22 - RSA 加密
- `rand` 0.8 - 随机密钥生成

## 数据模型

### weapi 加密流程 (`crypto.rs`)

1. 生成 16 字节随机密钥 (secKey)
2. 第一次 AES-CBC 加密：明文 + PRESET_KEY -> encText
3. 第二次 AES-CBC 加密：encText + secKey -> params
4. RSA 加密 secKey -> encSecKey
5. POST form: `params` + `encSecKey`

### LRC 歌词解析

支持标准 LRC 格式解析，包括多时间标签、翻译歌词合并。

## 测试与质量

当前无测试文件。建议测试方向：weapi 加密正确性、LRC 解析边界、API 响应解析。

## 相关文件清单

- `src/lib.rs` - NeteaseClient + MusicSource 实现（77 行）
- `src/crypto.rs` - weapi AES+RSA 加密（62 行）
- `src/api.rs` - API 端点实现（260 行）

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |
