[根目录](../../CLAUDE.md) > [crates](../) > **qqmusic**

# crates/qqmusic - QQ 音乐 API 客户端

## 模块职责

实现 QQ 音乐 (u.y.qq.com) 的 API 客户端，包括请求签名、搜索、播放地址获取（vkey 机制）、歌词等功能。实现了 `MusicSource` trait。

## 入口与启动

- 入口文件：`src/lib.rs`
- `QqMusicClient::new()` 创建客户端实例（内置 reqwest HTTP client，5s 超时，cookie jar，自动生成 GUID）

## 对外接口

`QqMusicClient` 实现 `MusicSource` trait：

- `search(query)` - 搜索歌曲（通过 musicu.fcg 接口）
- `get_stream_url(track_id)` - 获取音频流 URL（vkey 机制，songmid -> purl + sip）
- `get_lyrics(track_id)` - 获取歌词（通过 fcg_query_lyric_new.fcg）
- `get_album_art(track_id)` - 获取专辑封面（通过搜索结果中的 albummid 拼接 URL）
- `login(credentials)` - Cookie 方式登录

### 内部 API 端点

- `POST /cgi-bin/musicu.fcg` (SearchCgiService) - 搜索
- `POST /cgi-bin/musicu.fcg` (GetVkeyServer) - 播放地址
- `GET https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg` - 歌词

## 关键依赖与配置

- `reqwest` 0.12 (rustls-tls, json, cookies) - HTTP 客户端
- `md-5` 0.10 - 请求签名（MD5 哈希）
- `rand` 0.8 - GUID 生成

## 数据模型

### 签名机制 (`sign.rs`)

- `generate_guid()` - 生成 32 字符十六进制 GUID
- `sign_request(data)` - 对请求 JSON 做 MD5 签名，作为 query 参数传递

### 歌曲 ID

QQ 音乐使用 `songmid`（字符串）作为歌曲标识，区别于网易云的数字 ID。

## 测试与质量

当前无测试文件。建议测试方向：签名计算、GUID 格式、API 响应解析。

## 相关文件清单

- `src/lib.rs` - QqMusicClient + MusicSource 实现（73 行）
- `src/sign.rs` - GUID 生成 + MD5 签名（16 行）
- `src/api.rs` - API 端点实现（197 行）

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |
