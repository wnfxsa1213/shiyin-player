[根目录](../../CLAUDE.md) > [crates](../) > **qqmusic**

# crates/qqmusic - QQ 音乐 API 客户端

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-03-15T11:22:14 | 增量更新 | 新增 get_daily_recommend / get_personal_fm / try_refresh / set_on_refresh；实现 CookieStorage trait；凭据自动刷新机制 |
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |

## 模块职责

实现 QQ 音乐 (u.y.qq.com) 的 API 客户端，包括请求签名、搜索、播放地址获取（vkey 机制）、歌词、歌单、每日推荐、私人 FM 和凭据自动刷新等功能。实现了 `MusicSource` 和 `CookieStorage` trait。

## 入口与启动

- 入口文件：`src/lib.rs`
- `QqMusicClient::new()` 创建客户端实例（内置 reqwest HTTP client，3s 连接超时/10s 总超时，cookie jar，自动生成 GUID）

## 对外接口

`QqMusicClient` 实现 `MusicSource` trait：

- `search(query)` - 搜索歌曲（通过 musicu.fcg 接口），401 时自动尝试刷新凭据并重试
- `get_stream_url(track)` - 获取音频流 URL（vkey 机制，songmid/media_mid -> purl + sip），支持多音质梯度降级（320k MP3 -> 128k MP3 -> 96k AAC），401 时自动刷新
- `get_lyrics(track_id)` - 获取歌词（通过 fcg_query_lyric_new.fcg）
- `get_album_art(track_id)` - 获取专辑封面（通过搜索结果中的 albummid 拼接 URL）
- `login(credentials)` - Cookie 方式登录，通过 `GetLoginUserInfo` 轻量验证有效性
- `get_user_playlists()` - 获取用户歌单列表，401 时自动刷新
- `get_playlist_detail(id)` - 获取歌单详情，401 时自动刷新
- `get_daily_recommend()` - 获取每日推荐，401 时自动刷新
- `get_personal_fm()` - 获取私人 FM，401 时自动刷新
- `logout()` / `is_logged_in()` - 登出（同时清除 refresh_info）和状态检查

### 凭据自动刷新

- `set_refresh_info(info)` - 存储 RefreshInfo（refresh_key + refresh_token）
- `set_on_refresh(callback)` - 设置刷新成功回调（用于持久化新凭据）
- `try_refresh()` - 内部方法，401 时自动调用：通过 `refresh_credentials` API 获取新 musickey，重建 cookie，通知应用层持久化
- 使用 `TokioMutex` 防止并发刷新竞争

## 关键依赖与配置

- `reqwest` 0.12 (rustls-tls, json, cookies) - HTTP 客户端
- `md-5` 0.10 - 请求签名（MD5 哈希）
- `rand` 0.8 - GUID 生成
- `tokio` - 异步互斥锁（刷新防并发）

## 数据模型

### 签名机制 (`sign.rs`)

- `generate_guid()` - 生成 32 字符十六进制 GUID
- `sign_request(data)` - 对请求 JSON 做 MD5 签名，作为 query 参数传递
- `calculate_g_tk(skey)` - 从 skey 计算 g_tk（鉴权参数）
- `extract_uin_from_cookie(cookie)` - 从 cookie 提取 uin
- `extract_cookie_value(cookie, name)` - 从 cookie 字符串中提取指定字段值

### RefreshInfo

```rust
pub struct RefreshInfo {
    pub refresh_key: String,
    pub refresh_token: String,
}
```

### 歌曲 ID

QQ 音乐使用 `songmid`（字符串）作为歌曲标识，`media_mid`（可选）作为实际媒体文件标识。区别于网易云的数字 ID。

## 测试与质量

当前无测试文件。建议测试方向：签名计算、GUID 格式、API 响应解析、凭据刷新流程。

## 相关文件清单

- `src/lib.rs` - QqMusicClient + MusicSource + 凭据刷新实现（233 行）
- `src/sign.rs` - GUID 生成 + MD5 签名 + Cookie 解析
- `src/api.rs` - API 端点实现（搜索/播放/歌词/歌单/推荐/FM/凭据刷新）
