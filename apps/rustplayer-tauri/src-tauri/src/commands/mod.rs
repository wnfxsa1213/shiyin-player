use std::sync::Arc;
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
            Ok(Err(e)) => eprintln!("db cache read error for {sid:?}: {e}"),
            Err(e) => eprintln!("spawn_blocking join error: {e}"),
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
                eprintln!("search error from {msg}");
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
        Ok(Err(e)) => eprintln!("db lyrics cache read error: {e}"),
        Err(e) => eprintln!("spawn_blocking join error: {e}"),
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
            eprintln!("failed to persist cookie for {source:?}: {e}");
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
                eprintln!("playlist error from {msg}");
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
