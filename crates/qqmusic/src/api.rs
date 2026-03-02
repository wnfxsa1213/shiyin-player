use std::collections::HashMap;

use reqwest::header::COOKIE;
use rustplayer_core::{
    LyricsLine, MusicSourceId, Playlist, PlaylistBrief, SearchQuery, SourceError, StreamInfo, Track,
};
use serde_json::{json, Value};

use crate::sign::{calculate_g_tk, extract_skey_selection, extract_uin_from_cookie, SkeySource};

// QQ 音乐 API 客户端标识常量（模拟 Android 客户端 v13.2.5.8，对流媒体 URL 更宽容）
const API_CLIENT_TYPE: &str = "11";
const API_CLIENT_VERSION: &str = "13020508";

// 默认歌单名称（当 API 返回空字符串时使用）
const DEFAULT_PLAYLIST_NAME: &str = "未命名歌单";

// 音质梯度：按优先级从高到低排列（前缀, 扩展名, 比特率 kbps）
const QUALITY_TIERS: &[(&str, &str, u32)] = &[
    ("M800", ".mp3", 320),  // 320kbps MP3
    ("M500", ".mp3", 128),  // 128kbps MP3
    ("C400", ".m4a", 96),   // 96kbps AAC
];

/// Search for tracks on QQ Music.
///
/// Note: The `guid` parameter is currently unused for search requests but kept
/// for API consistency with other endpoints (e.g., song_url) that require it.
pub async fn search(
    http: &reqwest::Client,
    base_url: &str,
    query: SearchQuery,
    _guid: &str,
    cookie: Option<&str>,
) -> Result<Vec<Track>, SourceError> {
    let limit = query.limit.unwrap_or(30);
    let offset = query.offset.unwrap_or(0);
    let page_num = if limit == 0 { 1 } else { (offset / limit) + 1 };

    let data = json!({
        "comm": { "ct": API_CLIENT_TYPE, "cv": API_CLIENT_VERSION, "uin": "0" },
        "req": {
            "module": "music.search.SearchCgiService",
            "method": "DoSearchForQQMusicDesktop",
            "param": {
                "query": query.keyword,
                "num_per_page": limit,
                "page_num": page_num,
                "search_type": 0,
                "grp": 1
            }
        }
    });

    let value = musicu_post(http, base_url, &data, cookie).await?;
    let Some(list) = value.pointer("/req/data/body/song/list").and_then(|v| v.as_array()) else {
        return Ok(Vec::new());
    };

    Ok(list.iter().filter_map(parse_song).collect())
}

pub async fn song_url(
    http: &reqwest::Client,
    base_url: &str,
    track_id: &str,
    guid: &str,
    cookie: Option<&str>,
) -> Result<StreamInfo, SourceError> {
    // 构造多码率 filename 列表，单次请求尝试所有音质
    let filenames: Vec<String> = QUALITY_TIERS.iter()
        .map(|(prefix, ext, _)| format!("{prefix}{track_id}{ext}"))
        .collect();
    let songmids: Vec<&str> = QUALITY_TIERS.iter().map(|_| track_id).collect();
    let songtypes: Vec<i32> = QUALITY_TIERS.iter().map(|_| 0).collect();

    let data = json!({
        "comm": { "ct": API_CLIENT_TYPE, "cv": API_CLIENT_VERSION, "uin": "0" },
        "req": {
            "module": "vkey.GetVkeyServer",
            "method": "CgiGetVkey",
            "param": {
                "guid": guid,
                "songmid": songmids,
                "songtype": songtypes,
                "filename": filenames,
                "uin": "0",
                "loginflag": 1,
                "platform": "20"
            }
        }
    });

    let value = musicu_post(http, base_url, &data, cookie).await?;
    let vkey_data = value.pointer("/req/data")
        .ok_or_else(|| SourceError::InvalidResponse("missing vkey data".into()))?;

    let sip = vkey_data.get("sip")
        .and_then(|v| v.as_array())
        .and_then(|v| v.first())
        .and_then(|v| v.as_str())
        .unwrap_or("https://dl.stream.qqmusic.qq.com/");

    let midurl_list = vkey_data.get("midurlinfo")
        .and_then(|v| v.as_array());

    // 按音质梯度顺序遍历，返回第一个可用的 URL
    if let Some(list) = midurl_list {
        for (i, info) in list.iter().enumerate() {
            let purl = info.get("purl").and_then(|v| v.as_str()).unwrap_or("");
            if !purl.is_empty() {
                let format = purl.rsplit('.').next().unwrap_or("mp3").to_string();
                let bitrate = QUALITY_TIERS.get(i).map(|(_, _, br)| *br);
                log::info!(
                    "qqmusic song_url: selected {}kbps for track {track_id}",
                    bitrate.unwrap_or(0)
                );
                return Ok(StreamInfo { url: format!("{sip}{purl}"), format, bitrate });
            }
        }
    }

    log::warn!("qqmusic song_url: all quality tiers returned empty purl for track {track_id}");
    Err(SourceError::NotFound)
}

pub async fn lyrics(
    http: &reqwest::Client,
    track_id: &str,
) -> Result<Vec<LyricsLine>, SourceError> {
    // Retry up to 2 times on network errors
    let mut last_error = None;
    for attempt in 0..2 {
        if attempt > 0 {
            log::debug!("qqmusic lyrics: retry attempt {attempt} for track {track_id}");
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        let res = match http
            .get("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg")
            .query(&[("songmid", track_id), ("format", "json"), ("nobase64", "1")])
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_error = Some(SourceError::Network(e.to_string()));
                continue;
            }
        };

        if !res.status().is_success() {
            last_error = Some(SourceError::Network(format!("http {}", res.status())));
            continue;
        }

        let value: Value = match res.json().await {
            Ok(v) => v,
            Err(e) => {
                last_error = Some(SourceError::InvalidResponse(e.to_string()));
                continue;
            }
        };

        let lrc = value.get("lyric").and_then(|v| v.as_str()).unwrap_or("");
        let trans = value.get("trans").and_then(|v| v.as_str()).unwrap_or("");
        if lrc.is_empty() {
            log::debug!("qqmusic lyrics: no lyric content for track {track_id}");
        }
        if !trans.is_empty() {
            log::debug!("qqmusic lyrics: found translation lyrics for track {track_id}");
        }
        return Ok(parse_lyrics(lrc, trans));
    }

    Err(last_error.unwrap_or_else(|| SourceError::Network("all retry attempts failed".into())))
}

pub async fn user_playlists(
    http: &reqwest::Client,
    base_url: &str,
    cookie: Option<&str>,
) -> Result<Vec<PlaylistBrief>, SourceError> {
    user_playlists_with_pagination(http, base_url, cookie, 0, 100).await
}

pub async fn user_playlists_with_pagination(
    http: &reqwest::Client,
    base_url: &str,
    cookie: Option<&str>,
    offset: u32,
    limit: u32,
) -> Result<Vec<PlaylistBrief>, SourceError> {
    // Extract real uin from cookie, fallback to "0" if not found
    let uin = cookie
        .and_then(extract_uin_from_cookie)
        .unwrap_or_else(|| "0".to_string());

    let data = json!({
        "comm": { "ct": API_CLIENT_TYPE, "cv": API_CLIENT_VERSION, "uin": uin },
        "req": {
            "module": "music.playlist.PlaylistSquare",
            "method": "GetMyPlaylist",
            "param": {
                "uin": uin.parse::<i64>().unwrap_or(0),
                "sin": offset,
                "size": limit
            }
        }
    });

    log::debug!("qqmusic user_playlists: calling API with cookie = {}, uin = {}", cookie.is_some(), uin);
    let value = musicu_post(http, base_url, &data, cookie).await?;
    let code = value.pointer("/req/code").and_then(|v| v.as_i64()).unwrap_or(-1);
    log::info!("qqmusic user_playlists: API returned code = {}", code);

    // 细化错误码映射
    match code {
        0 => {}, // 成功
        -100 | -200 | 40000 => {
            // Enhanced logging for 40000 error - log full response for diagnosis
            let msg = value.pointer("/req/msg").and_then(|v| v.as_str()).unwrap_or("");
            let subcode = value.pointer("/req/subcode").and_then(|v| v.as_i64()).unwrap_or(0);
            log::warn!(
                "qqmusic user_playlists: unauthorized (code {}), cookie present = {}, msg = '{}', subcode = {}",
                code, cookie.is_some(), msg, subcode
            );
            if code == 40000 {
                log::debug!("qqmusic user_playlists: full response for 40000 error: {}", serde_json::to_string(&value).unwrap_or_default());
            }
            return Err(SourceError::Unauthorized);
        }
        -1001 | -1002 => return Err(SourceError::RateLimited), // 限流
        _ => {
            log::warn!("qqmusic user_playlists: unexpected code {}", code);
            return Err(SourceError::Internal(format!("api error code {}", code)));
        }
    }

    let Some(list) = value.pointer("/req/data/list").and_then(|v| v.as_array()) else {
        return Ok(Vec::new());
    };

    Ok(list.iter().filter_map(parse_playlist_brief).collect())
}

pub async fn playlist_detail(
    http: &reqwest::Client,
    base_url: &str,
    playlist_id: &str,
    cookie: Option<&str>,
) -> Result<Playlist, SourceError> {
    // 输入验证：检查 playlist_id 长度和字符集
    if playlist_id.is_empty() || playlist_id.len() > 64 {
        return Err(SourceError::InvalidResponse("invalid playlist_id length".into()));
    }
    if !playlist_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(SourceError::InvalidResponse("invalid playlist_id format".into()));
    }

    let data = json!({
        "comm": { "ct": API_CLIENT_TYPE, "cv": API_CLIENT_VERSION, "uin": "0" },
        "req": {
            "module": "music.srfDissInfo.airia",
            "method": "uniform_get_Dissinfo",
            "param": {
                "disstid": playlist_id,
                "userinfo": 1,
                "tag": 1
            }
        }
    });

    let value = musicu_post(http, base_url, &data, cookie).await?;
    let code = value.pointer("/req/code").and_then(|v| v.as_i64()).unwrap_or(-1);

    // 细化错误码映射
    match code {
        0 => {}, // 成功
        -100 | -200 | 40000 => return Err(SourceError::Unauthorized), // 鉴权失败/需要登录
        -404 | 404 => return Err(SourceError::NotFound), // 歌单不存在
        -1001 | -1002 => return Err(SourceError::RateLimited), // 限流
        _ => {
            log::warn!("qqmusic playlist_detail: unexpected code {} for playlist {}", code, playlist_id);
            return Err(SourceError::Internal(format!("api error code {}", code)));
        }
    }

    let data = value.pointer("/req/data").ok_or(SourceError::NotFound)?;
    let dirinfo = data.get("dirinfo").ok_or(SourceError::NotFound)?;

    // 使用默认值处理空字符串
    let name = dirinfo.get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_PLAYLIST_NAME)
        .to_string();
    let description = dirinfo.get("desc").and_then(|v| v.as_str()).map(|s| s.to_string());
    let cover_url = dirinfo.get("logo").and_then(|v| v.as_str()).map(|s| s.to_string());
    let tracks = data
        .get("songlist")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_song).collect())
        .unwrap_or_default();

    Ok(Playlist {
        id: playlist_id.to_string(),
        name,
        description,
        cover_url,
        tracks,
        source: MusicSourceId::Qqmusic,
    })
}

// --- Internal helpers ---

async fn musicu_post(
    http: &reqwest::Client,
    base_url: &str,
    data: &Value,
    cookie: Option<&str>,
) -> Result<Value, SourceError> {
    let url = format!("{base_url}/cgi-bin/musicu.fcg");

    // 任务 B.2：记录 g_tk 来源（p_skey/skey/qm_keyst/none）与 key 长度（严禁打印 value）。
    // 同时避免"cookie 存在但缺少 skey/p_skey"时悄悄回落到 5381，导致后续出现 40000 unauthorized 难以定位。
    let (skey_opt, source) = cookie
        .map(extract_skey_selection)
        .unwrap_or((None, SkeySource::None));
    let key_len = skey_opt.as_ref().map(|s| s.len()).unwrap_or(0);

    if cookie.is_some() {
        let source_label = match source {
            SkeySource::PSkey => "p_skey",
            SkeySource::Skey => "skey",
            SkeySource::QmKeyst => "qm_keyst",
            SkeySource::None => "none",
        };
        // 正常路径（p_skey/skey）用 debug，异常/兜底（qm_keyst/none）用 info，便于线上定位。
        if matches!(source, SkeySource::QmKeyst | SkeySource::None) {
            log::info!("qqmusic musicu_post: g_tk source = {source_label}, key_len = {key_len}");
        } else {
            log::debug!("qqmusic musicu_post: g_tk source = {source_label}, key_len = {key_len}");
        }
    }

    // Calculate g_tk from selected key (or default when not available).
    let g_tk = skey_opt.map(|s| calculate_g_tk(&s)).unwrap_or(5381);

    let mut req = http.post(url)
        .query(&[
            ("format", "json"),
            ("g_tk", &g_tk.to_string()),
            ("platform", "yqq"),
            ("needNewCode", "0"),
        ])
        .header("Referer", "https://y.qq.com/")
        .json(data);
    if let Some(c) = cookie {
        req = req.header(COOKIE, c);
    }
    let res = req.send().await.map_err(|e| SourceError::Network(e.to_string()))?;
    if !res.status().is_success() {
        return Err(SourceError::Network(format!("http {}", res.status())));
    }
    res.json::<Value>().await.map_err(|e| SourceError::InvalidResponse(e.to_string()))
}

fn parse_song(song: &Value) -> Option<Track> {
    // Handle both old format (songmid/songname) and new format (mid/name with nested objects)
    let mid = song.get("songmid").and_then(|v| v.as_str())
        .or_else(|| song.get("mid").and_then(|v| v.as_str()))
        .unwrap_or("");
    if mid.is_empty() { return None; }
    let name = song.get("songname").and_then(|v| v.as_str())
        .or_else(|| song.get("name").and_then(|v| v.as_str()))
        .unwrap_or("").to_string();
    let artists = song.get("singer")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|a| a.get("name").and_then(|v| v.as_str())).collect::<Vec<_>>().join(" / "))
        .unwrap_or_else(|| "Unknown".into());
    // Old format: albumname (string), New format: album.name (nested)
    let album = song.get("albumname").and_then(|v| v.as_str())
        .or_else(|| song.get("album").and_then(|v| v.get("name")).and_then(|v| v.as_str()))
        .unwrap_or("").to_string();
    let duration_ms = song.get("interval").and_then(|v| v.as_u64()).unwrap_or(0) * 1000;
    // Old format: albummid (string), New format: album.mid (nested)
    let album_mid = song.get("albummid").and_then(|v| v.as_str())
        .or_else(|| song.get("album").and_then(|v| v.get("mid")).and_then(|v| v.as_str()));
    let cover_url = album_mid
        .map(|mid| format!("https://y.qq.com/music/photo_new/T002R300x300M000{mid}.jpg"));

    Some(Track {
        id: mid.to_string(),
        name,
        artist: artists,
        album,
        duration_ms,
        source: MusicSourceId::Qqmusic,
        cover_url,
    })
}

fn parse_playlist_brief(item: &Value) -> Option<PlaylistBrief> {
    // dissid/tid 可能是字符串或数字
    let id = item.get("dissid")
        .or_else(|| item.get("tid"))
        .and_then(|v| {
            if let Some(s) = v.as_str() {
                Some(s.to_string())
            } else {
                v.as_i64().map(|n| n.to_string())
            }
        })?;

    // 使用默认值处理空字符串
    let name = item.get("dissname")
        .or_else(|| item.get("diss_name"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_PLAYLIST_NAME)
        .to_string();

    let cover_url = item
        .get("logo")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // song_cnt 兼容字符串和数字类型，使用 saturating_cast 防止溢出
    let track_count = item.get("song_cnt")
        .and_then(|v| {
            if let Some(n) = v.as_u64() {
                Some(n)
            } else if let Some(s) = v.as_str() {
                s.parse::<u64>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0)
        .min(u32::MAX as u64) as u32; // 防止 u64 -> u32 溢出

    Some(PlaylistBrief {
        id,
        name,
        cover_url,
        track_count,
        source: MusicSourceId::Qqmusic,
    })
}

fn parse_lyrics(lrc: &str, tlyric: &str) -> Vec<LyricsLine> {
    let base = parse_lrc_lines(lrc);
    let trans: HashMap<u64, String> = parse_lrc_lines(tlyric).into_iter().collect();
    base.into_iter()
        .map(|(time_ms, text)| LyricsLine {
            time_ms,
            text,
            translation: trans.get(&time_ms).cloned(),
        })
        .collect()
}

fn parse_lrc_lines(content: &str) -> Vec<(u64, String)> {
    let mut out = Vec::new();
    for line in content.lines() {
        let Some(last_end) = line.rfind(']') else { continue };
        let text = line[last_end + 1..].trim().to_string();
        let mut cursor = 0;
        while let Some(start) = line[cursor..].find('[') {
            let start = cursor + start;
            let Some(end_rel) = line[start + 1..].find(']') else { break };
            let end = start + 1 + end_rel;
            let tag = &line[start + 1..end];
            if let Some(ms) = parse_lrc_time(tag) {
                out.push((ms, text.clone()));
            }
            cursor = end + 1;
        }
    }
    out.sort_by_key(|(t, _)| *t);
    out
}

fn parse_lrc_time(tag: &str) -> Option<u64> {
    let mut parts = tag.split(':');
    let mm = parts.next()?.parse::<u64>().ok()?;
    let sec_part = parts.next()?;
    let (ss, frac) = sec_part.split_once('.').unwrap_or((sec_part, "0"));
    let ss = ss.parse::<u64>().ok()?;
    let ms = match frac.len() {
        0 => 0,
        1 => frac.parse::<u64>().ok()? * 100,
        2 => frac.parse::<u64>().ok()? * 10,
        _ => frac[..3].parse::<u64>().ok()?,
    };
    Some(mm * 60_000 + ss * 1_000 + ms)
}
