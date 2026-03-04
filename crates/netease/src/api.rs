use std::collections::HashMap;

use crate::crypto::weapi_encrypt;
use reqwest::header::COOKIE;
use rustplayer_core::{
    LyricsLine, MusicSourceId, Playlist, PlaylistBrief, SearchQuery, SourceError, StreamInfo, Track,
};
use serde_json::{json, Value};

pub async fn search(
    http: &reqwest::Client,
    base_url: &str,
    query: SearchQuery,
    cookie: Option<&str>,
) -> Result<Vec<Track>, SourceError> {
    let payload = json!({
        "s": query.keyword,
        "type": 1,
        "limit": query.limit.unwrap_or(30),
        "offset": query.offset.unwrap_or(0),
    });
    // Try /weapi/cloudsearch/get/web first (richer metadata), fall back to /weapi/search/get
    let (value, need_covers) = match weapi_post(http, base_url, "/weapi/cloudsearch/get/web", payload.clone(), cookie).await {
        Ok(v) => (v, false),
        Err(SourceError::Unauthorized) => {
            log::info!("cloudsearch requires login, falling back to /weapi/search/get");
            let v = weapi_post(http, base_url, "/weapi/search/get", payload, cookie).await?;
            (v, true) // old endpoint lacks cover URLs
        }
        Err(e) => return Err(e),
    };
    let Some(list) = value.pointer("/result/songs").and_then(|v| v.as_array()) else {
        return Ok(Vec::new());
    };
    let mut tracks: Vec<Track> = list.iter().filter_map(parse_song).collect();
    // Old search endpoint doesn't return cover URLs; batch-fetch via song detail API
    if need_covers && !tracks.is_empty() {
        match song_detail_covers(http, base_url, &tracks, cookie).await {
            Ok(covers) => {
                log::info!("fetched {} cover URLs via song detail API", covers.len());
                for track in &mut tracks {
                    if track.cover_url.is_none() {
                        if let Some(url) = covers.get(&track.id) {
                            track.cover_url = Some(url.clone());
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("failed to fetch cover URLs via song detail: {e}");
            }
        }
    }
    Ok(tracks)
}

pub async fn song_url(
    http: &reqwest::Client,
    base_url: &str,
    track_id: &str,
    cookie: Option<&str>,
) -> Result<StreamInfo, SourceError> {
    let id: i64 = track_id.parse()
        .map_err(|_| SourceError::InvalidResponse("invalid track id".into()))?;
    let payload = json!({
        "ids": [id],
        "level": "exhigh",
        "encodeType": "flac",
    });
    let value = weapi_post(http, base_url, "/weapi/song/enhance/player/url/v1", payload, cookie).await?;
    let data = value.get("data")
        .and_then(|v| v.as_array())
        .and_then(|v| v.first())
        .ok_or_else(|| SourceError::InvalidResponse("missing stream data".into()))?;

    let url = data.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if url.is_empty() {
        return Err(SourceError::NotFound);
    }

    let format = data.get("type").and_then(|v| v.as_str())
        .or_else(|| data.get("encodeType").and_then(|v| v.as_str()))
        .unwrap_or("unknown").to_string();
    let bitrate = data.get("br").and_then(|v| v.as_u64()).map(|v| v as u32);

    Ok(StreamInfo { url: url.to_string(), format, bitrate })
}

pub async fn lyrics(
    http: &reqwest::Client,
    base_url: &str,
    track_id: &str,
    cookie: Option<&str>,
) -> Result<Vec<LyricsLine>, SourceError> {
    log::debug!("netease lyrics: fetching track_id={track_id}");

    // Retry up to 2 times on network errors
    let mut last_error = None;
    for attempt in 0..2 {
        if attempt > 0 {
            log::debug!("netease lyrics: retry attempt {attempt} for track {track_id}");
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        let url = format!("{base_url}/api/song/lyric");
        let mut req = http
            .get(url)
            .query(&[("id", track_id), ("lv", "1"), ("tv", "1"), ("kv", "1"), ("rv", "1")]);
        if let Some(c) = cookie {
            req = req.header(COOKIE, c);
        }

        let res = match req.send().await {
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

        // Check API business error code (consistent with weapi_post)
        if let Some(code) = value.get("code").and_then(|v| v.as_i64()) {
            if code == 50000005 || code == -462 {
                log::warn!("netease lyrics: unauthorized (code {code}) for track {track_id}");
                return Err(SourceError::Unauthorized);
            }
            if code != 200 {
                log::warn!("netease lyrics: api error code {code} for track {track_id}");
                return Err(SourceError::InvalidResponse(
                    format!("netease lyrics code {code}"),
                ));
            }
        } else {
            log::warn!("netease lyrics: response missing 'code' field for track {track_id}");
            return Err(SourceError::InvalidResponse("response missing 'code' field".into()));
        }

        // Distinguish "no lyrics" from normal lyrics
        let lrc_str = match value.pointer("/lrc/lyric").and_then(|v| v.as_str()) {
            Some(s) if !s.trim().is_empty() => s,
            _ => {
                log::debug!("netease lyrics: no lrc content for track {track_id}");
                return Ok(Vec::new());
            }
        };
        let tlyric_str = value
            .pointer("/tlyric/lyric")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let lines = parse_lyrics(lrc_str, tlyric_str);
        log::debug!("netease lyrics: parsed {} lines for track {track_id}", lines.len());
        return Ok(lines);
    }

    Err(last_error.unwrap_or_else(|| SourceError::Network("all retry attempts failed".into())))
}

// --- Internal helpers ---

/// Batch-fetch cover URLs via /weapi/v3/song/detail (works without login)
async fn song_detail_covers(
    http: &reqwest::Client,
    base_url: &str,
    tracks: &[Track],
    cookie: Option<&str>,
) -> Result<HashMap<String, String>, SourceError> {
    let c_arr: Vec<Value> = tracks.iter()
        .map(|t| json!({"id": t.id.parse::<i64>().unwrap_or(0)}))
        .collect();
    let ids: Vec<i64> = tracks.iter()
        .filter_map(|t| t.id.parse::<i64>().ok())
        .collect();
    let payload = json!({
        "c": serde_json::to_string(&c_arr).unwrap_or_default(),
        "ids": serde_json::to_string(&ids).unwrap_or_default(),
    });
    let value = weapi_post(http, base_url, "/weapi/v3/song/detail", payload, cookie).await?;
    let mut map = HashMap::new();
    if let Some(songs) = value.get("songs").and_then(|v| v.as_array()) {
        for song in songs {
            if let (Some(id), Some(pic)) = (
                song.get("id").and_then(|v| v.as_i64()),
                song.pointer("/al/picUrl").and_then(|v| v.as_str()),
            ) {
                map.insert(id.to_string(), pic.to_string());
            }
        }
    }
    Ok(map)
}

/// Get cover URL for a single track via song detail API
pub async fn album_art(
    http: &reqwest::Client,
    base_url: &str,
    track_id: &str,
    cookie: Option<&str>,
) -> Result<Option<String>, SourceError> {
    let id: i64 = track_id.parse()
        .map_err(|_| SourceError::InvalidResponse("invalid track id".into()))?;
    let payload = json!({
        "c": format!("[{{\"id\":{id}}}]"),
        "ids": format!("[{id}]"),
    });
    let value = weapi_post(http, base_url, "/weapi/v3/song/detail", payload, cookie).await?;
    Ok(value.pointer("/songs/0/al/picUrl").and_then(|v| v.as_str()).map(|s| s.to_string()))
}

async fn weapi_post(
    http: &reqwest::Client,
    base_url: &str,
    path: &str,
    payload: Value,
    cookie: Option<&str>,
) -> Result<Value, SourceError> {
    let (params, enc_sec_key) = weapi_encrypt(&payload.to_string())?;
    let url = format!("{base_url}{path}");
    let mut req = http.post(url).form(&[("params", params), ("encSecKey", enc_sec_key)]);
    if let Some(c) = cookie {
        req = req.header(COOKIE, c);
    }
    let res = req.send().await.map_err(|e| SourceError::Network(e.to_string()))?;
    let status = res.status();
    if !status.is_success() {
        let mut body = res.text().await.unwrap_or_default();
        body.truncate(1024);
        return Err(SourceError::Network(format!("http {status}: {body}")));
    }
    let value: Value = res.json().await.map_err(|e| SourceError::InvalidResponse(e.to_string()))?;
    if let Some(code) = value.get("code").and_then(|v| v.as_i64()) {
        if code == 50000005 || code == -462 {
            return Err(SourceError::Unauthorized);
        }
        if code != 200 {
            return Err(SourceError::InvalidResponse(format!("code {code}")));
        }
    }
    Ok(value)
}

fn parse_song(song: &Value) -> Option<Track> {
    let id = song.get("id").and_then(|v| v.as_i64())?;
    let name = song.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let artists = song.get("ar").or_else(|| song.get("artists"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|a| a.get("name").and_then(|v| v.as_str())).collect::<Vec<_>>().join(" / "))
        .unwrap_or_else(|| "Unknown".into());
    let album_node = song.get("al").or_else(|| song.get("album"));
    let album = album_node.and_then(|v| v.get("name")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let cover_url = album_node.and_then(|v| v.get("picUrl")).and_then(|v| v.as_str()).map(|s| s.to_string());
    if cover_url.is_none() {
        log::debug!("netease: song id={id} has no cover_url, album keys: {:?}",
            album_node.and_then(|v| v.as_object()).map(|m| m.keys().cloned().collect::<Vec<_>>()));
    }
    let duration_ms = song.get("dt").or_else(|| song.get("duration")).and_then(|v| v.as_u64()).unwrap_or(0);

    Some(Track {
        id: id.to_string(),
        name,
        artist: artists,
        album,
        duration_ms,
        source: MusicSourceId::Netease,
        cover_url,
        media_mid: None,
    })
}

async fn get_user_uid(
    http: &reqwest::Client,
    base_url: &str,
    cookie: Option<&str>,
) -> Result<i64, SourceError> {
    let payload = json!({});
    let value = weapi_post(http, base_url, "/weapi/w/nuser/account/get", payload, cookie).await?;
    value
        .pointer("/account/id")
        .and_then(|v| v.as_i64())
        .ok_or(SourceError::Unauthorized)
}

pub async fn user_playlists(
    http: &reqwest::Client,
    base_url: &str,
    cookie: Option<&str>,
) -> Result<Vec<PlaylistBrief>, SourceError> {
    let uid = get_user_uid(http, base_url, cookie).await?;
    let payload = json!({
        "uid": uid,
        "limit": 50,
        "offset": 0,
    });
    let value = weapi_post(http, base_url, "/weapi/user/playlist", payload, cookie).await?;
    let Some(list) = value.pointer("/playlist").and_then(|v| v.as_array()) else {
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
    let payload = json!({
        "id": playlist_id,
        "n": 1000,
    });
    let value = weapi_post(http, base_url, "/weapi/v6/playlist/detail", payload, cookie).await?;
    let pl = value.get("playlist").ok_or_else(|| SourceError::NotFound)?;
    let name = pl.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let description = pl.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
    let cover_url = pl.get("coverImgUrl").and_then(|v| v.as_str()).map(|s| s.to_string());
    let tracks = pl
        .get("tracks")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_song).collect())
        .unwrap_or_default();

    Ok(Playlist {
        id: playlist_id.to_string(),
        name,
        description,
        cover_url,
        tracks,
        source: MusicSourceId::Netease,
    })
}

fn parse_playlist_brief(item: &Value) -> Option<PlaylistBrief> {
    let id = item.get("id").and_then(|v| v.as_i64())?;
    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let cover_url = item
        .get("coverImgUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let track_count = item.get("trackCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    Some(PlaylistBrief {
        id: id.to_string(),
        name,
        cover_url,
        track_count,
        source: MusicSourceId::Netease,
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
