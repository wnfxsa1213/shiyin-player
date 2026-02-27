use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use std::net::IpAddr;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use rustplayer_core::{AuthToken, Credentials, LyricsLine, MusicSourceId, Playlist, PlaylistBrief, PlayerCommand, SearchQuery, SourceError, PlayerError, Track};
use rustplayer_player::Player;
use rustplayer_sources::SourceRegistry;
use rustplayer_cache::SearchCache;
use crate::store;
use crate::db::Db;
use crate::trace_ctx;
use tracing::Instrument;

/// Maximum message length accepted by client_log (16 KB).
const CLIENT_LOG_MAX_LEN: usize = 16 * 1024;
/// Rate limit: max client_log calls per minute.
const CLIENT_LOG_RATE_LIMIT: u64 = 60;
/// Per-source timeout for concurrent API requests (search, playlists).
const SOURCE_TIMEOUT: Duration = Duration::from_secs(15);

static CLIENT_LOG_COUNT: AtomicU64 = AtomicU64::new(0);
static CLIENT_LOG_WINDOW: AtomicU64 = AtomicU64::new(0);

// --- Structured IPC Error ---

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum IpcError {
    Network(String),
    Unauthorized(String),
    NotFound(String),
    RateLimited(String),
    InvalidInput(String),
    Internal(String),
}

impl From<SourceError> for IpcError {
    fn from(e: SourceError) -> Self {
        match e {
            SourceError::Network(m) => IpcError::Network(m),
            SourceError::Unauthorized => IpcError::Unauthorized("unauthorized".into()),
            SourceError::NotFound => IpcError::NotFound("not found".into()),
            SourceError::RateLimited => IpcError::RateLimited("rate limited".into()),
            SourceError::InvalidResponse(m) => IpcError::Internal(m),
            SourceError::Unimplemented => IpcError::Internal("unimplemented".into()),
            SourceError::Internal(m) => IpcError::Internal(m),
        }
    }
}

impl From<PlayerError> for IpcError {
    fn from(e: PlayerError) -> Self {
        match e {
            PlayerError::InvalidState(m) => IpcError::InvalidInput(m),
            PlayerError::ChannelClosed => IpcError::Internal("channel closed".into()),
            _ => IpcError::Internal(e.to_string()),
        }
    }
}

async fn run_with_trace<T, F>(cmd: &'static str, trace_id: Option<String>, fut: F) -> Result<T, IpcError>
where
    F: std::future::Future<Output = Result<T, IpcError>>,
{
    let trace_id = trace_ctx::ensure_trace_id(trace_id);
    let span = trace_ctx::command_span(cmd, &trace_id);
    let result = fut.instrument(span).await;
    if let Err(ref e) = result {
        match e {
            IpcError::Internal(_) => tracing::error!(cmd, error = ?e, "command failed"),
            _ => tracing::warn!(cmd, error = ?e, "command failed"),
        }
    }
    result
}

#[tauri::command]
pub async fn search_music(
    query: String,
    source: Option<MusicSourceId>,
    trace_id: Option<String>,
    registry: State<'_, Arc<SourceRegistry>>,
    cache: State<'_, Arc<SearchCache>>,
    db: State<'_, Arc<Db>>,
) -> Result<Vec<Track>, IpcError> {
    run_with_trace("search_music", trace_id, async {
        let query = query.trim().to_string();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let sq = SearchQuery { keyword: query.clone(), limit: Some(30), offset: Some(0) };
        let sources: Vec<Arc<dyn rustplayer_core::MusicSource>> = match source {
            Some(id) => registry.get(id).cloned().into_iter().collect(),
            None => registry.all().to_vec(),
        };

        // Parallel search across all sources
        let parent_span = tracing::Span::current();
        let mut handles = Vec::new();
        for src in sources {
            let sid = src.id();
            let cache = cache.inner().clone();
            let db = db.inner().clone();
            let kw = query.clone();
            let sq = sq.clone();
            let span = parent_span.clone();
            handles.push(tokio::spawn(async move {
                match tokio::time::timeout(SOURCE_TIMEOUT, async {
                // L1: memory LRU
                if let Some(cached) = cache.get(sid, &kw) {
                    return Ok(cached);
                }
                // L2: SQLite
                let db_ref = db.clone();
                let kw2 = kw.clone();
                match tauri::async_runtime::spawn_blocking(move || {
                    db_ref.get_cached_tracks(sid, &kw2)
                }).await {
                    Ok(Ok(Some(cached))) => {
                        cache.set(sid, kw, cached.clone());
                        return Ok(cached);
                    }
                    Ok(Err(e)) => log::warn!("db cache read error for {sid:?}: {e}"),
                    Err(e) => log::warn!("spawn_blocking join error: {e}"),
                    _ => {}
                }
                // L3: API
                match src.search(sq).await {
                    Ok(tracks) => {
                        cache.set(sid, kw.clone(), tracks.clone());
                        let db_ref = db.clone();
                        let kw3 = kw;
                        let t = tracks.clone();
                        let span = tracing::Span::current();
                        tokio::spawn(async move {
                            if let Err(e) = tauri::async_runtime::spawn_blocking(move || {
                                db_ref.cache_tracks(sid, &kw3, &t)
                            }).await.unwrap_or_else(|e| Err(e.to_string())) {
                                log::warn!("db cache write error for {sid:?}: {e}");
                            }
                        }.instrument(span));
                        Ok(tracks)
                    }
                    Err(e) => {
                        log::warn!("search error from {}: {e}", sid_label(sid));
                        Err((sid_label(sid), e))
                    }
                }
                }).await {
                    Ok(result) => result,
                    Err(_) => {
                        tracing::warn!(source = ?sid, "search timed out");
                        Err((sid_label(sid), SourceError::Network(format!("{} search timed out", sid_label(sid)))))
                    }
                }
            }.instrument(span)));
        }

        let mut results = Vec::new();
        let mut errors: Vec<(&str, SourceError)> = Vec::new();
        for handle in handles {
            match handle.await {
                Ok(Ok(tracks)) => results.extend(tracks),
                Ok(Err((label, e))) => errors.push((label, e)),
                Err(e) => {
                    tracing::error!(error = ?e, "search task join error");
                    errors.push(("task", SourceError::Internal(format!("join: {e}"))));
                }
            }
        }
        if results.is_empty() && !errors.is_empty() {
            // Pick the most representative error type from collected errors
            let summary = errors.iter()
                .map(|(label, e)| format!("{label}: {e}"))
                .collect::<Vec<_>>()
                .join("; ");
            // Use the first error's type to determine the IpcError kind
            let representative = &errors[0].1;
            return Err(match representative {
                SourceError::Unauthorized => IpcError::Unauthorized(summary),
                SourceError::NotFound => IpcError::NotFound(summary),
                SourceError::RateLimited => IpcError::RateLimited(summary),
                SourceError::InvalidResponse(_) => IpcError::Internal(summary),
                SourceError::Unimplemented => IpcError::Internal(summary),
                SourceError::Internal(_) => IpcError::Internal(summary),
                SourceError::Network(_) => IpcError::Network(summary),
            });
        }
        Ok(results)
    }).await
}

#[tauri::command]
pub async fn play_track(
    track: Track,
    trace_id: Option<String>,
    registry: State<'_, Arc<SourceRegistry>>,
    player: State<'_, Arc<Player>>,
) -> Result<(), IpcError> {
    run_with_trace("play_track", trace_id, async {
        let src = registry.get(track.source).ok_or(IpcError::NotFound("source not found".into()))?;
        let stream = src.get_stream_url(&track.id).await.map_err(IpcError::from)?;
        player.send(PlayerCommand::Load(track, stream)).await.map_err(IpcError::from)
    }).await
}

#[tauri::command]
pub async fn toggle_playback(trace_id: Option<String>, player: State<'_, Arc<Player>>) -> Result<(), IpcError> {
    run_with_trace("toggle_playback", trace_id, async {
        player.send(PlayerCommand::Toggle).await.map_err(IpcError::from)
    }).await
}

#[tauri::command]
pub async fn seek(trace_id: Option<String>, position_ms: u64, player: State<'_, Arc<Player>>) -> Result<(), IpcError> {
    run_with_trace("seek", trace_id, async {
        player.send(PlayerCommand::Seek(position_ms)).await.map_err(IpcError::from)
    }).await
}

#[tauri::command]
pub async fn set_volume(trace_id: Option<String>, volume: f32, player: State<'_, Arc<Player>>) -> Result<(), IpcError> {
    run_with_trace("set_volume", trace_id, async {
        if !volume.is_finite() {
            return Err(IpcError::InvalidInput("invalid volume value".into()));
        }
        let volume = volume.clamp(0.0, 1.0);
        player.send(PlayerCommand::SetVolume(volume)).await.map_err(IpcError::from)
    }).await
}

#[tauri::command]
pub async fn get_lyrics(
    track_id: String,
    source: MusicSourceId,
    trace_id: Option<String>,
    registry: State<'_, Arc<SourceRegistry>>,
    db: State<'_, Arc<Db>>,
) -> Result<Vec<LyricsLine>, IpcError> {
    run_with_trace("get_lyrics", trace_id, async {
        let track_id = track_id.trim().to_string();
        if track_id.is_empty() {
            return Err(IpcError::InvalidInput("track_id is empty".into()));
        }
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
        let src = registry.get(source).ok_or(IpcError::NotFound("source not found".into()))?;
        let lyrics = src.get_lyrics(&track_id).await.map_err(IpcError::from)?;
        let db_ref = db.inner().clone();
        let tid = track_id.clone();
        let l = lyrics.clone();
        let span = tracing::Span::current();
        tokio::spawn(async move {
            if let Err(e) = tauri::async_runtime::spawn_blocking(move || {
                db_ref.cache_lyrics(&tid, source, &l)
            }).await.unwrap_or_else(|e| Err(e.to_string())) {
                log::warn!("db lyrics cache write error: {e}");
            }
        }.instrument(span));
        Ok(lyrics)
    }).await
}

#[tauri::command]
pub async fn login(
    source: MusicSourceId,
    credentials: Credentials,
    trace_id: Option<String>,
    registry: State<'_, Arc<SourceRegistry>>,
    app: AppHandle,
) -> Result<AuthToken, IpcError> {
    run_with_trace("login", trace_id, async {
        let src = registry.get(source).ok_or(IpcError::NotFound("source not found".into()))?;
        let token = src.login(credentials.clone()).await.map_err(IpcError::from)?;
        if let Credentials::Cookie { cookie } = &credentials {
            if let Err(e) = store::save_cookie(&app, source, cookie) {
                log::error!("failed to persist cookie for {source:?}: {e}");
            }
        }
        let _ = app.emit("login://success", source);
        Ok(token)
    }).await
}

#[tauri::command]
pub async fn logout(
    source: MusicSourceId,
    trace_id: Option<String>,
    registry: State<'_, Arc<SourceRegistry>>,
    app: AppHandle,
) -> Result<(), IpcError> {
    run_with_trace("logout", trace_id, async {
        // Clear in-memory session
        if let Some(src) = registry.get(source) {
            src.logout();
        }
        // Delete persisted cookie
        store::delete_cookie(&app, source).map_err(IpcError::Internal)
    }).await
}

#[tauri::command]
pub async fn open_login_window(
    source: MusicSourceId,
    trace_id: Option<String>,
    app: AppHandle,
    registry: State<'_, Arc<SourceRegistry>>,
) -> Result<(), IpcError> {
    run_with_trace("open_login_window", trace_id, async {
        // If login window already exists, close it first (source may differ)
        if let Some(existing) = app.get_webview_window("login-window") {
            let _ = existing.close();
            // Small delay to let the window destroy
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        let (login_url, cookie_domain): (&str, &str) = match source {
            MusicSourceId::Netease => (
                "https://music.163.com/#/login",
                "https://music.163.com",
            ),
            MusicSourceId::Qqmusic => (
                "https://y.qq.com/",
                "https://y.qq.com",
            ),
        };

        let label = sid_label(source);

        // Oneshot channel: signals that login was detected (URL left login page)
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let tx = Arc::new(std::sync::Mutex::new(Some(tx)));
        let tx_clone = tx.clone();

        let parsed_url: tauri::Url = login_url.parse()
            .map_err(|e| IpcError::Internal(format!("invalid login url: {e}")))?;

        let login_window = tauri::WebviewWindowBuilder::new(
            &app,
            "login-window",
            tauri::WebviewUrl::External(parsed_url),
        )
        .title(format!("登录 - {label}"))
        .inner_size(900.0, 700.0)
        .center()
        .on_navigation(move |nav_url| {
            // Intercept our login-confirmed callback URL
            if nav_url.host_str() == Some("__shiyin_cookie_cb__") {
                if let Ok(mut guard) = tx_clone.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(());
                    }
                }
                return false; // Block this navigation
            }
            true // Allow all real navigations
        })
        .build()
        .map_err(|e| IpcError::Internal(format!("failed to create login window: {e}")))?;

        // Spawn async task: poll for login detection + handle callback
        let window_handle = login_window.clone();
        let app_clone = app.clone();
        let registry_clone = registry.inner().clone();
        let cookie_domain = cookie_domain.to_string();

        tauri::async_runtime::spawn(async move {
            let closed = Arc::new(AtomicBool::new(false));
            let closed_for_event = closed.clone();

            window_handle.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    closed_for_event.store(true, Ordering::SeqCst);
                }
            });

            // Wait for page to load before polling
            tokio::time::sleep(Duration::from_secs(3)).await;

            let start = std::time::Instant::now();
            let timeout = Duration::from_secs(300); // 5 minutes
            let mut interval = tokio::time::interval(Duration::from_secs(2));

            let mut rx = rx;
            let mut login_detected = false;

            // Essential cookie keys per source (only persist what's needed)
            let essential_keys: &[&str] = match source {
                MusicSourceId::Netease => &["MUSIC_U", "NMTID", "__csrf"],
                MusicSourceId::Qqmusic => &["qqmusic_key", "Q_H_L", "qm_keyst"],
            };

            // Strong auth key: only this cookie proves login succeeded.
            // Used by cookie probe to avoid false positives from tracking/csrf cookies.
            let auth_probe_key: &str = match source {
                MusicSourceId::Netease => "MUSIC_U",
                MusicSourceId::Qqmusic => "qqmusic_key",
            };

            // Pre-allocate for probe closure (avoid per-tick allocation)
            #[cfg(target_os = "linux")]
            let probe_key_owned = auth_probe_key.to_string();

            loop {
                // Strategy 2 (Linux): fire-and-forget cookie probe as a separate select branch.
                // Avoids blocking the tick handler while waiting for webkit response.
                #[cfg(target_os = "linux")]
                let probe_fut = probe_cookies_webkit(
                    &window_handle, &cookie_domain, &probe_key_owned,
                );
                #[cfg(not(target_os = "linux"))]
                let probe_fut = std::future::pending::<bool>();

                tokio::select! {
                    _ = interval.tick() => {
                        if closed.load(Ordering::SeqCst) {
                            tracing::info!("login window closed by user");
                            let _ = app_clone.emit("login://timeout", source);
                            break;
                        }
                        if start.elapsed() > timeout {
                            tracing::warn!("login window timed out");
                            let _ = window_handle.close();
                            let _ = app_clone.emit("login://timeout", source);
                            break;
                        }

                        // Strategy 1: Inject JS to detect login via URL/DOM heuristics.
                        let js = match source {
                            MusicSourceId::Netease => {
                                concat!(
                                    "(function(){try{",
                                    "var h=window.location.href;",
                                    "var urlOk=h.indexOf('music.163.com')!==-1&&h.indexOf('/login')===-1&&h.indexOf('passport')===-1;",
                                    "var domOk=!!(document.querySelector('.head_pic,.m-user-avatar,.j-avatar')||document.querySelector('a[href*=\"/user/home\"]'));",
                                    "if(urlOk||domOk){window.location.href='http://__shiyin_cookie_cb__/?confirmed=1';}",
                                    "}catch(e){}})();"
                                )
                            }
                            MusicSourceId::Qqmusic => {
                                concat!(
                                    "(function(){try{",
                                    "var u=document.querySelector('.mod_header_login_info .js_user,.top_login__link--user,.mod_profile');",
                                    "if(u){window.location.href='http://__shiyin_cookie_cb__/?confirmed=1';}",
                                    "}catch(e){}})();"
                                )
                            }
                        };
                        let _ = window_handle.eval(js);
                    }
                    probed = probe_fut => {
                        if probed {
                            tracing::info!("cookie probe detected login for {source:?}");
                            login_detected = true;
                            break;
                        }
                        // probe returned false — will retry next iteration
                    }
                    result = &mut rx => {
                        if result.is_ok() {
                            login_detected = true;
                        }
                        break;
                    }
                }
            }

            if !login_detected {
                return;
            }

            // Small delay: cookies may still be written by the browser after URL change
            tokio::time::sleep(Duration::from_millis(500)).await;

            tracing::info!("login detected for {source:?}, extracting cookies");

            let cookie_str = extract_cookies_platform(
                &window_handle, &cookie_domain, essential_keys, source,
            ).await;

            if cookie_str.is_empty() {
                tracing::warn!("extracted cookie is empty");
                let _ = app_clone.emit("login://timeout", source);
                let _ = window_handle.close();
                return;
            }

            tracing::info!("cookie extracted for {source:?}, validating...");

            // Validate cookie by attempting login
            if let Some(src) = registry_clone.get(source) {
                let creds = Credentials::Cookie { cookie: cookie_str.clone() };
                match src.login(creds).await {
                    Ok(_) => {
                        if let Err(e) = store::save_cookie(&app_clone, source, &cookie_str) {
                            tracing::error!("failed to save cookie: {e}");
                        }
                        let _ = app_clone.emit("login://success", source);
                    }
                    Err(e) => {
                        tracing::error!("login after cookie capture failed: {e}");
                        let _ = app_clone.emit("login://timeout", source);
                    }
                }
            }
            let _ = window_handle.close();
        });

        Ok(())
    }).await
}

#[tauri::command]
pub async fn check_login_status(
    trace_id: Option<String>,
    registry: State<'_, Arc<SourceRegistry>>,
) -> Result<std::collections::HashMap<MusicSourceId, bool>, IpcError> {
    run_with_trace("check_login_status", trace_id, async {
        let mut status = std::collections::HashMap::new();
        for src in registry.all() {
            status.insert(src.id(), src.is_logged_in());
        }
        Ok(status)
    }).await
}

#[tauri::command]
pub async fn client_log(
    level: String,
    message: String,
    trace_id: Option<String>,
) -> Result<(), IpcError> {
    run_with_trace("client_log", trace_id, async {
        // Rate limiting: allow CLIENT_LOG_RATE_LIMIT calls per 60-second window.
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() / 60; // minute bucket
        let prev_window = CLIENT_LOG_WINDOW.load(Ordering::Relaxed);
        if now_secs != prev_window {
            CLIENT_LOG_WINDOW.store(now_secs, Ordering::Relaxed);
            CLIENT_LOG_COUNT.store(1, Ordering::Relaxed);
        } else {
            let count = CLIENT_LOG_COUNT.fetch_add(1, Ordering::Relaxed);
            if count >= CLIENT_LOG_RATE_LIMIT {
                if count == CLIENT_LOG_RATE_LIMIT {
                    tracing::warn!("client_log rate limit reached, dropping further messages this minute");
                }
                return Ok(());
            }
        }

        // Truncate oversized messages to prevent log DoS.
        let message = if message.len() > CLIENT_LOG_MAX_LEN {
            let truncated = &message[..message.floor_char_boundary(CLIENT_LOG_MAX_LEN)];
            format!("{truncated}... [truncated, original {len} bytes]", len = message.len())
        } else {
            message
        };

        match level.as_str() {
            "error" => tracing::error!(message = %message, "client"),
            "warn" => tracing::warn!(message = %message, "client"),
            "info" => tracing::info!(message = %message, "client"),
            "debug" => tracing::debug!(message = %message, "client"),
            other => tracing::info!(level = %other, message = %message, "client"),
        }
        Ok(())
    }).await
}

#[tauri::command]
pub async fn get_user_playlists(
    source: Option<MusicSourceId>,
    trace_id: Option<String>,
    registry: State<'_, Arc<SourceRegistry>>,
) -> Result<Vec<PlaylistBrief>, IpcError> {
    run_with_trace("get_user_playlists", trace_id, async {
        let sources: Vec<Arc<dyn rustplayer_core::MusicSource>> = match source {
            Some(id) => registry.get(id).cloned().into_iter().collect(),
            None => registry.all().to_vec(),
        };
        // Parallel fetch — preserve SourceError type for proper IPC mapping
        let parent_span = tracing::Span::current();
        let mut handles = Vec::new();
        for src in sources {
            let span = parent_span.clone();
            handles.push(tokio::spawn(async move {
                match tokio::time::timeout(SOURCE_TIMEOUT, src.get_user_playlists()).await {
                    Ok(result) => result.map_err(|e| (src.name().to_string(), e)),
                    Err(_) => {
                        let name = src.name().to_string();
                        tracing::warn!(source = %name, "playlist fetch timed out");
                        Err((name.clone(), SourceError::Network(format!("{name} timed out"))))
                    }
                }
            }.instrument(span)));
        }
        let mut results = Vec::new();
        let mut errors: Vec<(String, SourceError)> = Vec::new();
        for handle in handles {
            match handle.await {
                Ok(Ok(playlists)) => results.extend(playlists),
                Ok(Err((label, e))) => {
                    tracing::warn!(source = %label, error = ?e, "playlist fetch error");
                    errors.push((label, e));
                }
                Err(e) => errors.push(("task".into(), SourceError::Internal(format!("join: {e}")))),
            }
        }
        if results.is_empty() && !errors.is_empty() {
            let summary = errors.iter()
                .map(|(label, e)| format!("{label}: {e}"))
                .collect::<Vec<_>>()
                .join("; ");
            let representative = &errors[0].1;
            return Err(match representative {
                SourceError::Unauthorized => IpcError::Unauthorized(summary),
                SourceError::NotFound => IpcError::NotFound(summary),
                SourceError::RateLimited => IpcError::RateLimited(summary),
                SourceError::InvalidResponse(_) => IpcError::Internal(summary),
                SourceError::Unimplemented => IpcError::Internal(summary),
                SourceError::Internal(_) => IpcError::Internal(summary),
                SourceError::Network(_) => IpcError::Network(summary),
            });
        }
        Ok(results)
    }).await
}

#[tauri::command]
pub async fn get_playlist_detail(
    id: String,
    source: MusicSourceId,
    trace_id: Option<String>,
    registry: State<'_, Arc<SourceRegistry>>,
) -> Result<Playlist, IpcError> {
    run_with_trace("get_playlist_detail", trace_id, async {
        let id = id.trim().to_string();
        if id.is_empty() {
            return Err(IpcError::InvalidInput("playlist id is empty".into()));
        }
        let src = registry.get(source).ok_or(IpcError::NotFound("source not found".into()))?;
        src.get_playlist_detail(&id).await.map_err(IpcError::from)
    }).await
}

fn sid_label(sid: MusicSourceId) -> &'static str {
    match sid {
        MusicSourceId::Netease => "网易云音乐",
        MusicSourceId::Qqmusic => "QQ音乐",
    }
}

// --- Platform-specific cookie extraction ---

/// Extract cookies from the webview. On Linux, uses webkit2gtk CookieManager
/// to read HttpOnly cookies. On other platforms, falls back to JS document.cookie.
async fn extract_cookies_platform(
    window: &tauri::WebviewWindow,
    _cookie_domain: &str,
    essential_keys: &[&str],
    _source: MusicSourceId,
) -> String {
    #[cfg(target_os = "linux")]
    {
        let result = extract_cookies_webkit(window, _cookie_domain, essential_keys).await;
        if !result.is_empty() {
            return result;
        }
        tracing::warn!("webkit cookie extraction returned empty, falling back to JS");
    }

    // Fallback: JS document.cookie (cannot read HttpOnly cookies)
    extract_cookies_js(window, essential_keys).await
}

/// JS-based cookie extraction fallback (non-HttpOnly cookies only).
async fn extract_cookies_js(
    window: &tauri::WebviewWindow,
    essential_keys: &[&str],
) -> String {
    let keys_json: Vec<String> = essential_keys.iter().map(|k| format!("'{k}'")).collect();
    let keys_arr = keys_json.join(",");
    let js = format!(
        "(function(){{try{{var keys=[{keys_arr}];var c=document.cookie;var pairs=c.split('; ');var out=[];for(var i=0;i<pairs.length;i++){{var p=pairs[i].split('=');if(keys.indexOf(p[0])!==-1){{out.push(pairs[i]);}}}}window.location.href='http://__shiyin_js_cookie__/?c='+encodeURIComponent(out.join('; '));}}catch(e){{}}}})();"
    );
    // We can't easily get the result back from eval, so this is best-effort.
    // The on_navigation handler would need to be extended for this path.
    // For now, just try eval and return empty (webkit path is primary on Linux).
    let _ = window.eval(&js);
    tracing::debug!("JS cookie extraction attempted (best-effort)");
    String::new()
}

/// Linux-only: extract cookies via webkit2gtk CookieManager (reads HttpOnly).
#[cfg(target_os = "linux")]
async fn extract_cookies_webkit(
    window: &tauri::WebviewWindow,
    cookie_domain: &str,
    essential_keys: &[&str],
) -> String {
    let (cookie_tx, cookie_rx) = tokio::sync::oneshot::channel::<String>();
    let domain = cookie_domain.to_string();
    let keys: Vec<String> = essential_keys.iter().map(|s| s.to_string()).collect();

    let extract_result = window.with_webview(move |platform_wv| {
        use webkit2gtk::*;

        let webview: webkit2gtk::WebView = platform_wv.inner();
        if let Some(data_manager) = webview.website_data_manager() {
            if let Some(cookie_manager) = data_manager.cookie_manager() {
                cookie_manager.cookies(
                    &domain,
                    gio::Cancellable::NONE,
                    move |result: Result<Vec<soup::Cookie>, glib::Error>| {
                        let cookie_str = match result {
                            Ok(mut cookies) => {
                                cookies.iter_mut()
                                    .filter_map(|c| {
                                        let name = c.name()?;
                                        if !keys.iter().any(|k| k == &name) {
                                            return None;
                                        }
                                        let value = c.value()?;
                                        if value.is_empty() {
                                            return None;
                                        }
                                        Some(format!("{name}={value}"))
                                    })
                                    .collect::<Vec<_>>()
                                    .join("; ")
                            }
                            Err(e) => {
                                tracing::error!("webkit cookie extraction failed: {e}");
                                String::new()
                            }
                        };
                        let _ = cookie_tx.send(cookie_str);
                    },
                );
            } else {
                let _ = cookie_tx.send(String::new());
            }
        } else {
            let _ = cookie_tx.send(String::new());
        }
    });

    if let Err(e) = extract_result {
        tracing::error!("with_webview failed: {e}");
        return String::new();
    }

    match tokio::time::timeout(Duration::from_secs(5), cookie_rx).await {
        Ok(Ok(s)) => s,
        _ => {
            tracing::error!("cookie extraction timed out or failed");
            String::new()
        }
    }
}

/// Linux-only: lightweight probe — checks if the strong auth cookie exists yet.
/// Used in the polling loop to detect login without relying on page DOM.
/// Only checks for a single definitive auth key to avoid false positives
/// from tracking/csrf cookies that may exist before login.
#[cfg(target_os = "linux")]
async fn probe_cookies_webkit(
    window: &tauri::WebviewWindow,
    cookie_domain: &str,
    auth_key: &str,
) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    let domain = cookie_domain.to_string();
    let key = auth_key.to_string();
    let tx = std::sync::Mutex::new(Some(tx));

    let ok = window.with_webview(move |platform_wv| {
        use webkit2gtk::*;

        let webview: webkit2gtk::WebView = platform_wv.inner();
        let dm = webview.website_data_manager();
        let cm = dm.as_ref().and_then(|d| d.cookie_manager());
        if let Some(cm) = cm {
            let sender = tx.lock().ok().and_then(|mut g| g.take());
            if let Some(sender) = sender {
                cm.cookies(
                    &domain,
                    gio::Cancellable::NONE,
                    move |result: Result<Vec<soup::Cookie>, glib::Error>| {
                        let has_key = match result {
                            Ok(mut cookies) => {
                                cookies.iter_mut().any(|c| {
                                    c.name()
                                        .map(|n| n == key)
                                        .unwrap_or(false)
                                })
                            }
                            Err(e) => {
                                tracing::debug!("cookie probe query error: {e}");
                                false
                            }
                        };
                        let _ = sender.send(has_key);
                    },
                );
            }
        } else {
            tracing::debug!("cookie probe: no cookie manager available");
            if let Some(sender) = tx.lock().ok().and_then(|mut g| g.take()) {
                let _ = sender.send(false);
            }
        }
    });

    if let Err(e) = ok {
        tracing::debug!("cookie probe with_webview failed: {e}");
        return false;
    }

    tokio::time::timeout(Duration::from_millis(500), rx)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or(false)
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

const MAX_COVER_BYTES: usize = 5 * 1024 * 1024; // 5MB

fn is_allowed_cover_url(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" && url.scheme() != "http" {
        return false;
    }
    let host = match url.host_str() {
        Some(h) => h,
        None => return false,
    };
    if host.parse::<IpAddr>().is_ok() {
        return false;
    }
    COVER_DOMAIN_ALLOWLIST.iter().any(|allowed| {
        host == *allowed || host.ends_with(&format!(".{allowed}"))
    })
}

fn upgrade_cover_url(url: &str) -> String {
    if url.starts_with("http://") {
        format!("https://{}", &url[7..])
    } else {
        url.to_string()
    }
}

fn is_image_magic(bytes: &[u8]) -> bool {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return true;
    }
    if bytes.len() >= 4 && bytes[..4] == [0x89, 0x50, 0x4E, 0x47] {
        return true;
    }
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
        log::debug!("no colorful pixels found, falling back to average color");
        let mut sin_sum = 0.0f64;
        let mut cos_sum = 0.0f64;
        let mut total_s = 0.0;
        let mut total_l = 0.0;
        let mut count = 0u32;
        for pixel in rgb.pixels() {
            let (h, s, l) = rgb_to_hsl(pixel[0], pixel[1], pixel[2]);
            if l > 10.0 && l < 95.0 {
                let rad = h.to_radians();
                sin_sum += rad.sin();
                cos_sum += rad.cos();
                total_s += s;
                total_l += l;
                count += 1;
            }
        }
        if count == 0 {
            return None;
        }
        let avg_h = sin_sum.atan2(cos_sum).to_degrees().rem_euclid(360.0);
        let avg_s = (total_s / count as f64).max(30.0);
        let avg_l = (total_l / count as f64).clamp(45.0, 65.0);
        return Some([avg_h, avg_s, avg_l]);
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
    trace_id: Option<String>,
    http: State<'_, reqwest::Client>,
) -> Result<[f64; 3], IpcError> {
    run_with_trace("extract_cover_color", trace_id, async {
        let upgraded = upgrade_cover_url(&url);
        let parsed = reqwest::Url::parse(&upgraded).map_err(|e| IpcError::InvalidInput(format!("invalid url: {e}")))?;
        if !is_allowed_cover_url(&parsed) {
            log::warn!("cover url rejected (not in allowlist): {upgraded}");
            return Err(IpcError::InvalidInput("url not in cover domain allowlist".into()));
        }
        let resp = http.get(parsed.clone())
            .send().await
            .map_err(|e| {
                log::warn!("cover fetch failed for {upgraded}: {e}");
                IpcError::Network(format!("fetch failed: {e}"))
            })?;
        if !resp.status().is_success() {
            log::warn!("cover fetch returned http {} for {upgraded}", resp.status());
            return Err(IpcError::Network(format!("http {}", resp.status())));
        }
        if let Some(cl) = resp.content_length() {
            if cl as usize > MAX_COVER_BYTES {
                return Err(IpcError::InvalidInput("cover image too large".into()));
            }
        }
        use futures_util::StreamExt;
        let mut stream = resp.bytes_stream();
        let mut buf = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| IpcError::Network(format!("read body: {e}")))?;
            buf.extend_from_slice(&chunk);
            if buf.len() > MAX_COVER_BYTES {
                return Err(IpcError::InvalidInput("cover image too large".into()));
            }
        }
        let bytes = bytes::Bytes::from(buf);
        if !is_image_magic(&bytes) {
            log::warn!("cover response is not a valid image ({} bytes) for {upgraded}", bytes.len());
            return Err(IpcError::InvalidInput("response is not a valid image".into()));
        }
        let hsl = tauri::async_runtime::spawn_blocking(move || {
            extract_dominant_hsl(&bytes)
        }).await
            .map_err(|e| IpcError::Internal(format!("task join: {e}")))?
            .ok_or_else(|| IpcError::Internal("could not extract color".to_string()))?;
        Ok(hsl)
    }).await
}

