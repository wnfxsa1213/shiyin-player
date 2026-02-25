use std::sync::Arc;
use std::net::IpAddr;
use tauri::{AppHandle, State};
use rustplayer_core::{AuthToken, Credentials, LyricsLine, MusicSourceId, Playlist, PlaylistBrief, PlayerCommand, SearchQuery, Track};
use rustplayer_player::Player;
use rustplayer_sources::SourceRegistry;
use rustplayer_cache::SearchCache;
use crate::store;
use crate::db::Db;

#[tauri::command]
pub async fn search_music(
    query: String,
    source: Option<MusicSourceId>,
    registry: State<'_, Arc<SourceRegistry>>,
    cache: State<'_, Arc<SearchCache>>,
    db: State<'_, Arc<Db>>,
) -> Result<Vec<Track>, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let sq = SearchQuery { keyword: query.clone(), limit: Some(30), offset: Some(0) };
    let sources: Vec<Arc<dyn rustplayer_core::MusicSource>> = match source {
        Some(id) => registry.get(id).cloned().into_iter().collect(),
        None => registry.all().to_vec(),
    };

    let mut results = Vec::new();
    let mut errors = Vec::new();
    for src in sources {
        let sid = src.id();
        // L1: memory LRU
        if let Some(cached) = cache.get(sid, &query) {
            results.extend(cached);
            continue;
        }
        // L2: SQLite (spawn_blocking to avoid blocking async runtime)
        let db_ref = db.inner().clone();
        let kw = query.clone();
        match tauri::async_runtime::spawn_blocking(move || {
            db_ref.get_cached_tracks(sid, &kw)
        }).await {
            Ok(Ok(Some(cached))) => {
                cache.set(sid, query.clone(), cached.clone());
                results.extend(cached);
                continue;
            }
            Ok(Err(e)) => log::warn!("db cache read error for {sid:?}: {e}"),
            Err(e) => log::warn!("spawn_blocking join error: {e}"),
            _ => {}
        }
        // L3: API
        match src.search(sq.clone()).await {
            Ok(tracks) => {
                cache.set(sid, query.clone(), tracks.clone());
                let db_ref = db.inner().clone();
                let kw = query.clone();
                let t = tracks.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    db_ref.cache_tracks(sid, &kw, &t)
                });
                results.extend(tracks);
            }
            Err(e) => {
                let msg = format!("{}: {e}", src.name());
                log::warn!("search error: {msg}");
                errors.push(msg);
            }
        }
    }
    if results.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(results)
}

#[tauri::command]
pub async fn play_track(
    track: Track,
    registry: State<'_, Arc<SourceRegistry>>,
    player: State<'_, Arc<Player>>,
) -> Result<(), String> {
    let src = registry.get(track.source).ok_or("source not found")?;
    let stream = src.get_stream_url(&track.id).await.map_err(|e| e.to_string())?;
    player.send(PlayerCommand::Load(track, stream)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_playback(player: State<'_, Arc<Player>>) -> Result<(), String> {
    player.send(PlayerCommand::Toggle).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn seek(position_ms: u64, player: State<'_, Arc<Player>>) -> Result<(), String> {
    player.send(PlayerCommand::Seek(position_ms)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_volume(volume: f32, player: State<'_, Arc<Player>>) -> Result<(), String> {
    if !volume.is_finite() {
        return Err("invalid volume value".into());
    }
    let volume = volume.clamp(0.0, 1.0);
    player.send(PlayerCommand::SetVolume(volume)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_lyrics(
    track_id: String,
    source: MusicSourceId,
    registry: State<'_, Arc<SourceRegistry>>,
    db: State<'_, Arc<Db>>,
) -> Result<Vec<LyricsLine>, String> {
    let track_id = track_id.trim().to_string();
    if track_id.is_empty() {
        return Err("track_id is empty".into());
    }
    // Check SQLite cache first (spawn_blocking)
    let db_ref = db.inner().clone();
    let tid = track_id.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        db_ref.get_cached_lyrics(&tid, source)
    }).await {
        Ok(Ok(Some(cached))) => return Ok(cached),
        Ok(Err(e)) => log::warn!("db lyrics cache read error: {e}"),
        Err(e) => log::warn!("spawn_blocking join error: {e}"),
        _ => {}
    }
    let src = registry.get(source).ok_or("source not found")?;
    let lyrics = src.get_lyrics(&track_id).await.map_err(|e| e.to_string())?;
    let db_ref = db.inner().clone();
    let tid = track_id.clone();
    let l = lyrics.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        db_ref.cache_lyrics(&tid, source, &l)
    });
    Ok(lyrics)
}

#[tauri::command]
pub async fn login(
    source: MusicSourceId,
    credentials: Credentials,
    registry: State<'_, Arc<SourceRegistry>>,
    app: AppHandle,
) -> Result<AuthToken, String> {
    let src = registry.get(source).ok_or("source not found")?;
    let token = src.login(credentials.clone()).await.map_err(|e| e.to_string())?;

    // Persist cookie if login succeeded (only for Cookie credentials)
    if let Credentials::Cookie { cookie } = &credentials {
        if let Err(e) = store::save_cookie(&app, source, cookie) {
            log::error!("failed to persist cookie for {source:?}: {e}");
        }
    }

    Ok(token)
}

#[tauri::command]
pub async fn logout(
    source: MusicSourceId,
    app: AppHandle,
) -> Result<(), String> {
    store::delete_cookie(&app, source)
}

#[tauri::command]
pub async fn get_user_playlists(
    source: Option<MusicSourceId>,
    registry: State<'_, Arc<SourceRegistry>>,
) -> Result<Vec<PlaylistBrief>, String> {
    let sources: Vec<Arc<dyn rustplayer_core::MusicSource>> = match source {
        Some(id) => registry.get(id).cloned().into_iter().collect(),
        None => registry.all().to_vec(),
    };
    let mut results = Vec::new();
    let mut errors = Vec::new();
    for src in sources {
        match src.get_user_playlists().await {
            Ok(playlists) => results.extend(playlists),
            Err(e) => {
                let msg = format!("{}: {e}", src.name());
                log::warn!("playlist error: {msg}");
                errors.push(msg);
            }
        }
    }
    if results.is_empty() && !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(results)
}

#[tauri::command]
pub async fn get_playlist_detail(
    id: String,
    source: MusicSourceId,
    registry: State<'_, Arc<SourceRegistry>>,
) -> Result<Playlist, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("playlist id is empty".into());
    }
    let src = registry.get(source).ok_or("source not found")?;
    src.get_playlist_detail(&id).await.map_err(|e| e.to_string())
}

// --- Cover color extraction (bypasses CORS) ---

const COVER_DOMAIN_ALLOWLIST: &[&str] = &[
    "music.126.net",
    "p1.music.126.net",
    "p2.music.126.net",
    "p3.music.126.net",
    "p4.music.126.net",
    "y.gtimg.cn",
    "imgcache.qq.com",
    "y.qq.com",
    "qqmusic.qq.com",
];

const MAX_COVER_BYTES: usize = 2 * 1024 * 1024; // 2MB

fn is_allowed_cover_url(url: &reqwest::Url) -> bool {
    // Allow both http and https for whitelisted CDN domains (Netease CDN uses http)
    if url.scheme() != "https" && url.scheme() != "http" {
        return false;
    }
    let host = match url.host_str() {
        Some(h) => h,
        None => return false,
    };
    // Reject IP addresses (prevents SSRF to private networks)
    if host.parse::<IpAddr>().is_ok() {
        return false;
    }
    COVER_DOMAIN_ALLOWLIST.iter().any(|allowed| {
        host == *allowed || host.ends_with(&format!(".{allowed}"))
    })
}

/// Upgrade http cover URLs to https (Netease CDN supports both)
fn upgrade_cover_url(url: &str) -> String {
    if url.starts_with("http://") {
        format!("https://{}", &url[7..])
    } else {
        url.to_string()
    }
}

fn is_image_magic(bytes: &[u8]) -> bool {
    // JPEG: FF D8 FF
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return true;
    }
    // PNG: 89 50 4E 47
    if bytes.len() >= 4 && bytes[..4] == [0x89, 0x50, 0x4E, 0x47] {
        return true;
    }
    // WebP: RIFF....WEBP
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return true;
    }
    false
}

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let rn = r as f64 / 255.0;
    let gn = g as f64 / 255.0;
    let bn = b as f64 / 255.0;
    let max = rn.max(gn).max(bn);
    let min = rn.min(gn).min(bn);
    let l = (max + min) / 2.0;
    if (max - min).abs() < f64::EPSILON {
        return (0.0, 0.0, l * 100.0);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if (max - rn).abs() < f64::EPSILON {
        ((gn - bn) / d + if gn < bn { 6.0 } else { 0.0 }) / 6.0
    } else if (max - gn).abs() < f64::EPSILON {
        ((bn - rn) / d + 2.0) / 6.0
    } else {
        ((rn - gn) / d + 4.0) / 6.0
    };
    (h * 360.0, s * 100.0, l * 100.0)
}

fn extract_dominant_hsl(img_bytes: &[u8]) -> Option<[f64; 3]> {
    // Validate image dimensions before full decode (prevent decompression bombs)
    let reader = image::ImageReader::new(std::io::Cursor::new(img_bytes))
        .with_guessed_format().ok()?;
    let (w, h) = reader.into_dimensions().ok()?;
    if w > 8192 || h > 8192 {
        log::warn!("cover image too large: {w}x{h}");
        return None;
    }

    let img = image::load_from_memory(img_bytes).ok()?;
    let thumb = img.resize_exact(20, 20, image::imageops::FilterType::Triangle);
    let rgb = thumb.to_rgb8();

    // 12 hue buckets of 30° each: (sum_h, sum_s, sum_l, count)
    let mut buckets = [(0.0f64, 0.0f64, 0.0f64, 0u32); 12];

    for pixel in rgb.pixels() {
        let (h, s, l) = rgb_to_hsl(pixel[0], pixel[1], pixel[2]);
        if s < 20.0 || l < 15.0 || l > 90.0 {
            continue;
        }
        let idx = ((h / 30.0) as usize) % 12;
        buckets[idx].0 += h;
        buckets[idx].1 += s;
        buckets[idx].2 += l;
        buckets[idx].3 += 1;
    }

    let best = buckets.iter().enumerate()
        .max_by_key(|(_, b)| b.3)?;
    if best.1 .3 == 0 {
        return None;
    }

    let count = best.1 .3 as f64;
    let h = best.1 .0 / count;
    let s = (best.1 .1 / count).max(50.0);
    let l = (best.1 .2 / count).clamp(45.0, 65.0);

    Some([h, s, l])
}

#[tauri::command]
pub async fn extract_cover_color(
    url: String,
    http: State<'_, reqwest::Client>,
) -> Result<[f64; 3], String> {
    let upgraded = upgrade_cover_url(&url);
    let parsed = reqwest::Url::parse(&upgraded).map_err(|e| format!("invalid url: {e}"))?;
    if !is_allowed_cover_url(&parsed) {
        return Err("url not in cover domain allowlist".into());
    }

    let resp = http.get(parsed)
        .send().await
        .map_err(|e| format!("fetch failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status()));
    }

    // Pre-check Content-Length if available
    if let Some(cl) = resp.content_length() {
        if cl as usize > MAX_COVER_BYTES {
            return Err("cover image too large".into());
        }
    }

    // Stream body with size limit
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("read body: {e}"))?;
        buf.extend_from_slice(&chunk);
        if buf.len() > MAX_COVER_BYTES {
            return Err("cover image too large".into());
        }
    }
    let bytes = bytes::Bytes::from(buf);

    // Magic bytes sniff
    if !is_image_magic(&bytes) {
        return Err("response is not a valid image".into());
    }

    // Extract dominant color in blocking task (image decoding is CPU-bound)
    let hsl = tauri::async_runtime::spawn_blocking(move || {
        extract_dominant_hsl(&bytes)
    }).await
        .map_err(|e| format!("task join: {e}"))?
        .ok_or_else(|| "could not extract color".to_string())?;

    Ok(hsl)
}
