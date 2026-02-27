use std::collections::HashMap;

use reqwest::header::COOKIE;
use rustplayer_core::{LyricsLine, MusicSourceId, SearchQuery, SourceError, StreamInfo, Track};
use serde_json::{json, Value};

pub async fn search(
    http: &reqwest::Client,
    base_url: &str,
    query: SearchQuery,
    guid: &str,
    cookie: Option<&str>,
) -> Result<Vec<Track>, SourceError> {
    let limit = query.limit.unwrap_or(30);
    let offset = query.offset.unwrap_or(0);
    let page_num = if limit == 0 { 1 } else { (offset / limit) + 1 };

    let data = json!({
        "comm": { "ct": "19", "cv": "1859", "uin": "0" },
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

    let _ = guid;
    Ok(list.iter().filter_map(parse_song).collect())
}

pub async fn song_url(
    http: &reqwest::Client,
    base_url: &str,
    track_id: &str,
    guid: &str,
    cookie: Option<&str>,
) -> Result<StreamInfo, SourceError> {
    let data = json!({
        "comm": { "ct": "19", "cv": "1859", "uin": "0" },
        "req": {
            "module": "vkey.GetVkeyServer",
            "method": "CgiGetVkey",
            "param": {
                "guid": guid,
                "songmid": [track_id],
                "songtype": [0],
                "uin": "0",
                "loginflag": 1,
                "platform": "20"
            }
        }
    });

    let value = musicu_post(http, base_url, &data, cookie).await?;
    let vkey_data = value.pointer("/req/data")
        .ok_or_else(|| SourceError::InvalidResponse("missing vkey data".into()))?;
    let purl = vkey_data.get("midurlinfo")
        .and_then(|v| v.as_array())
        .and_then(|v| v.first())
        .and_then(|v| v.get("purl"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if purl.is_empty() {
        return Err(SourceError::NotFound);
    }
    let sip = vkey_data.get("sip")
        .and_then(|v| v.as_array())
        .and_then(|v| v.first())
        .and_then(|v| v.as_str())
        .unwrap_or("https://dl.stream.qqmusic.qq.com/");
    let format = purl.rsplit('.').next().unwrap_or("mp3").to_string();

    Ok(StreamInfo { url: format!("{sip}{purl}"), format, bitrate: None })
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
        if lrc.is_empty() {
            log::debug!("qqmusic lyrics: no lyric content for track {track_id}");
        }
        return Ok(parse_lyrics(lrc, ""));
    }

    Err(last_error.unwrap_or_else(|| SourceError::Network("all retry attempts failed".into())))
}

// --- Internal helpers ---

async fn musicu_post(
    http: &reqwest::Client,
    base_url: &str,
    data: &Value,
    cookie: Option<&str>,
) -> Result<Value, SourceError> {
    let url = format!("{base_url}/cgi-bin/musicu.fcg");
    let mut req = http.post(url)
        .query(&[("format", "json")])
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
