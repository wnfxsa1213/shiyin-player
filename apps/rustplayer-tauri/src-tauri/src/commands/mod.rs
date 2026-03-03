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
/// Login window timeout (5 minutes).
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// Login detection polling interval.
const LOGIN_POLL_INTERVAL: Duration = Duration::from_secs(2);
/// Initial delay before starting login detection.
const LOGIN_INITIAL_DELAY: Duration = Duration::from_secs(3);
/// Cookie extraction timeout.
const COOKIE_EXTRACT_TIMEOUT: Duration = Duration::from_secs(5);
/// Event emission timeout.
const EVENT_EMIT_TIMEOUT: Duration = Duration::from_secs(2);
/// Timeout for clearing cookies via webkit.
const COOKIE_CLEAR_TIMEOUT: Duration = Duration::from_secs(2);

// --- 登录相关 Cookie 最小集合 ---
//
// 设计目标：
// 1) 清理范围最小化：避免误删同域下与其它功能相关的 cookie（代码审查 Major#1）。
// 2) 持久化最小化：只保存后续鉴权必需的 cookie，避免落盘敏感 token（代码审查 Major#3）。
//
// 注意：这里只包含"必要/最小集合"。可选项如需排查问题，只应在内存诊断日志中体现，
// 不应持久化到本地存储。
const QQMUSIC_LOGIN_COOKIES: &[&str] = &["qqmusic_key", "p_skey", "skey", "p_uin", "uin", "login_type"];
const QQMUSIC_ESSENTIAL_COOKIES: &[&str] = &[
    "qqmusic_key",
    "p_skey",
    "skey",
    "p_uin",
    "uin",
    "login_type",
    "qm_keyst", // 仅用于兼容部分登录态的兜底，不一定对所有接口有效
];
const NETEASE_LOGIN_COOKIES: &[&str] = &["MUSIC_U", "NMTID", "__csrf"];

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

/// Helper function to map SourceError to IpcError with user-friendly messages.
/// Sanitizes error messages to avoid exposing internal implementation details.
/// Detailed errors are logged at debug level for troubleshooting.
fn map_source_error_to_ipc(error: &SourceError) -> IpcError {
    // Log detailed error for debugging (not exposed to frontend)
    tracing::debug!(error = ?error, "source error details");

    match error {
        SourceError::Unauthorized => IpcError::Unauthorized("需要登录或登录已过期".into()),
        SourceError::NotFound => IpcError::NotFound("未找到请求的资源".into()),
        SourceError::RateLimited => IpcError::RateLimited("请求过于频繁，请稍后再试".into()),
        SourceError::InvalidResponse(_) => IpcError::Internal("服务响应格式错误".into()),
        SourceError::Unimplemented => IpcError::Internal("该功能暂未实现".into()),
        SourceError::Internal(_) => IpcError::Internal("内部错误，请稍后重试".into()),
        SourceError::Network(_) => IpcError::Network("网络连接失败，请检查网络设置".into()),
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
        // Clone shared resources once before the loop
        let cache_arc = cache.inner().clone();
        let db_arc = db.inner().clone();
        let query_str = query.clone();
        let search_query = sq.clone();

        for src in sources {
            let sid = src.id();
            let cache = Arc::clone(&cache_arc);
            let db = Arc::clone(&db_arc);
            let kw = query_str.clone();
            let sq = search_query.clone();
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
                    Ok(Err(e)) => tracing::warn!("db cache read error for {sid:?}: {e}"),
                    Err(e) => tracing::warn!("spawn_blocking join error: {e}"),
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
                                tracing::warn!("db cache write error for {sid:?}: {e}");
                            }
                        }.instrument(span));
                        Ok(tracks)
                    }
                    Err(e) => {
                        tracing::warn!("search error from {}: {e}", sid.display_name());
                        Err((sid.display_name(), e))
                    }
                }
                }).await {
                    Ok(result) => result,
                    Err(_) => {
                        tracing::warn!(source = ?sid, "search timed out");
                        Err((sid.display_name(), SourceError::Network(format!("{} search timed out", sid.display_name()))))
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
            // Log detailed error summary for debugging
            let summary = errors.iter()
                .map(|(label, e)| format!("{label}: {e}"))
                .collect::<Vec<_>>()
                .join("; ");
            tracing::warn!(error_summary = %summary, "all sources failed");

            // Prioritize errors by severity: Unauthorized > RateLimited > others
            let representative = errors.iter()
                .find(|(_, e)| matches!(e, SourceError::Unauthorized))
                .or_else(|| errors.iter().find(|(_, e)| matches!(e, SourceError::RateLimited)))
                .or_else(|| errors.first());

            match representative {
                Some((_, err)) => return Err(map_source_error_to_ipc(err)),
                None => return Err(IpcError::Internal("未知错误：所有音源均无响应".into())),
            }
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
            Ok(Err(e)) => tracing::warn!("db lyrics cache read error: {e}"),
            Err(e) => tracing::warn!("spawn_blocking join error: {e}"),
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
                tracing::warn!("db lyrics cache write error: {e}");
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
                tracing::error!("failed to persist cookie for {source:?}: {e}");
            }
        }
        if let Err(e) = app.emit("login://success", source) {
            tracing::warn!("failed to emit login://success event for {source:?}: {e}");
        }
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

        let (login_url, cookie_domains): (&str, Vec<&str>) = match source {
            MusicSourceId::Netease => (
                "https://music.163.com/#/login",
                vec!["https://music.163.com"],
            ),
            MusicSourceId::Qqmusic => (
                "https://y.qq.com/",
                // 重要：webkit2gtk CookieManager 的 cookies() 需要"合法 URI"。
                // 之前的 "https://.qq.com" 不是合法 URI，会导致查询失败，
                // 进而拿不到 HttpOnly 的关键 cookie（如 p_skey/p_uin），最终用 qm_keyst 误算 g_tk 触发 40000。
                vec![
                    "https://y.qq.com/",
                    "https://qq.com/",
                    "https://music.qq.com/",
                ],
            ),
        };

        let label = source.display_name();

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

        // Clear old cookies before login to prevent false positives from expired cookies
        #[cfg(target_os = "linux")]
        {
            tracing::debug!("clearing old cookies for {source:?} before login");
            // 代码审查 Major#1：只清理登录相关的"最小集合"，避免影响同域其它功能。
            let clear_keys: &[&str] = match source {
                MusicSourceId::Netease => NETEASE_LOGIN_COOKIES,
                MusicSourceId::Qqmusic => QQMUSIC_LOGIN_COOKIES,
            };
            for domain in &cookie_domains {
                clear_cookies_webkit(&login_window, domain, clear_keys).await;
            }
        }

        // Spawn async task: poll for login detection + handle callback
        let window_handle = login_window.clone();
        let app_clone = app.clone();
        let registry_clone = registry.inner().clone();
        let cookie_domains_owned: Vec<String> = cookie_domains.iter().map(|s| s.to_string()).collect();

        tauri::async_runtime::spawn(async move {
            let closed = Arc::new(AtomicBool::new(false));
            let closed_for_event = closed.clone();

            window_handle.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    closed_for_event.store(true, Ordering::SeqCst);
                }
            });

            // Wait for page to load before polling
            tokio::time::sleep(LOGIN_INITIAL_DELAY).await;

            let start = std::time::Instant::now();
            let timeout = LOGIN_TIMEOUT;
            let mut interval = tokio::time::interval(LOGIN_POLL_INTERVAL);

            let mut rx = rx;
            let mut login_detected = false;

            // Essential cookie keys per source (only persist what's needed)
            // 代码审查 Major#3：持久化 cookie 严格收敛到"必需 key"，可选 key 只做诊断不落盘。
            let essential_keys: &[&str] = match source {
                MusicSourceId::Netease => NETEASE_LOGIN_COOKIES,
                MusicSourceId::Qqmusic => QQMUSIC_ESSENTIAL_COOKIES,
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
                let probe_fut = probe_cookies_webkit_any(
                    &window_handle, &cookie_domains_owned, &probe_key_owned,
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
                            // Double-check window wasn't closed before marking login as detected
                            if closed.load(Ordering::SeqCst) {
                                tracing::debug!("cookie probe detected login but window already closed, ignoring");
                                let _ = app_clone.emit("login://timeout", source);
                                break;
                            }
                            tracing::debug!("cookie probe detected login for {source:?}");
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

            // Final check: ensure window is still open before extracting cookies
            if closed.load(Ordering::SeqCst) {
                tracing::debug!("window closed before cookie extraction, aborting");
                return;
            }

            // Small delay: cookies may still be written by the browser after URL change
            tokio::time::sleep(Duration::from_millis(500)).await;

            tracing::debug!("login detected for {source:?}, extracting cookies");

            let cookie_str = extract_cookies_from_domains(
                &window_handle, &cookie_domains, essential_keys, source,
            ).await;

            if cookie_str.is_empty() {
                tracing::warn!("extracted cookie is empty");
                let _ = app_clone.emit("login://timeout", source);
                let _ = window_handle.close();
                return;
            }

            tracing::debug!("cookie extracted for {source:?}, validating...");

            // Validate cookie by attempting login
            if let Some(src) = registry_clone.get(source) {
                tracing::info!("found source in registry, calling login");
                let creds = Credentials::Cookie { cookie: cookie_str.clone() };
                match src.login(creds).await {
                    Ok(_) => {
                        tracing::debug!("login validation succeeded, saving cookie");
                        if let Err(e) = store::save_cookie(&app_clone, source, &cookie_str) {
                            tracing::error!("failed to save cookie: {e}");
                        } else {
                            tracing::debug!("cookie saved successfully");
                        }

                        // Best-effort: try to extract refresh tokens from webview localStorage
                        if matches!(source, MusicSourceId::Qqmusic) {
                            if let Some((rk, rt)) = extract_refresh_from_webview(&window_handle).await {
                                tracing::info!("extracted refresh tokens from webview (refresh_key len={}, refresh_token len={})", rk.len(), rt.len());
                                if let Err(e) = store::save_refresh_info(&app_clone, source, &rk, &rt) {
                                    tracing::warn!("failed to persist refresh info: {e}");
                                }
                            } else {
                                tracing::debug!("no refresh tokens found in webview localStorage (best-effort)");
                            }
                        }

                        tracing::info!("emitting login://success event");
                        let _ = app_clone.emit("login://success", source);
                    }
                    Err(e) => {
                        tracing::error!("login after cookie capture failed: {e}");
                        let _ = app_clone.emit("login://timeout", source);
                    }
                }
            } else {
                tracing::error!("source {source:?} not found in registry!");
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
            // Log detailed error summary for debugging
            let summary = errors.iter()
                .map(|(label, e)| format!("{label}: {e}"))
                .collect::<Vec<_>>()
                .join("; ");
            tracing::warn!(error_summary = %summary, "all playlist sources failed");

            // Prioritize errors by severity: Unauthorized > RateLimited > others
            let representative = errors.iter()
                .find(|(_, e)| matches!(e, SourceError::Unauthorized))
                .or_else(|| errors.iter().find(|(_, e)| matches!(e, SourceError::RateLimited)))
                .or_else(|| errors.first());

            match representative {
                Some((_, err)) => return Err(map_source_error_to_ipc(err)),
                None => return Err(IpcError::Internal("未知错误：所有音源均无响应".into())),
            }
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

// --- Platform-specific cookie extraction ---

/// Extract cookies from multiple domains and merge them.
async fn extract_cookies_from_domains(
    window: &tauri::WebviewWindow,
    cookie_domains: &[&str],
    essential_keys: &[&str],
    source: MusicSourceId,
) -> String {
    // 代码审查 Minor#4：使用 BTreeMap 保证输出稳定（避免 HashMap 迭代顺序不确定）。
    // Cookie header 对顺序不敏感，但稳定输出便于日志比对与问题复现。
    let mut all_cookies = std::collections::BTreeMap::new();

    for domain in cookie_domains {
        tracing::debug!("extracting cookies from domain: {}", domain);
        let cookies = extract_cookies_platform(window, domain, essential_keys, source).await;

        if cookies.is_empty() {
            tracing::debug!("no cookies extracted from domain: {}", domain);
            continue;
        }

        // 诊断日志（任务 B.1）：仅输出"提取到的 cookie 名称集合"（不含 value）。
        // 说明：cookie 的 HttpOnly/Secure 等属性在 Linux(webkit2gtk) 路径下会在 extract_cookies_webkit 内以 debug 级别输出。
        let mut domain_keys: Vec<String> = Vec::new();

        // Parse and merge cookies
        for pair in cookies.split("; ") {
            if let Some((key, value)) = pair.split_once('=') {
                domain_keys.push(key.to_string());
                all_cookies.insert(key.to_string(), value.to_string());
            }
        }

        domain_keys.sort();
        domain_keys.dedup();
        tracing::info!(
            "domain {} extracted {} cookie keys (values omitted): {:?}",
            domain,
            domain_keys.len(),
            domain_keys
        );
    }

    if all_cookies.is_empty() {
        tracing::warn!("no cookies extracted from any domain");
        return String::new();
    }

    // 任务 C.3：必需 cookie 校验（避免进入后续验证后才以 40000 失败）。
    // QQ 音乐的最小鉴权集合（现代 API）：
    // - qqmusic_key：强鉴权 cookie，直接验证登录态（authst 字段）
    // - p_uin|uin：用于请求体 uin
    // 注意：p_skey/skey 仅用于计算 g_tk，现代 QQ 音乐 API 不依赖 g_tk 认证，
    // 缺少时使用默认值 5381，不影响鉴权。
    if matches!(source, MusicSourceId::Qqmusic) {
        let has_skey = all_cookies.contains_key("p_skey") || all_cookies.contains_key("skey");
        let has_uin = all_cookies.contains_key("p_uin") || all_cookies.contains_key("uin");
        let has_qqmusic_key = all_cookies.contains_key("qqmusic_key");

        if !(has_uin && has_qqmusic_key) {
            let mut present_keys: Vec<String> = all_cookies.keys().cloned().collect();
            present_keys.sort();
            tracing::warn!(
                "qqmusic cookie incomplete after extraction: has(p_skey|skey)={}, has(p_uin|uin)={}, has(qqmusic_key)={}, keys_present={:?}",
                has_skey,
                has_uin,
                has_qqmusic_key,
                present_keys
            );
            return String::new();
        }
        if !has_skey {
            tracing::debug!("qqmusic cookie: no p_skey/skey found, g_tk will use default 5381 (modern API uses qqmusic_key for auth)");
        }
    }

    // 诊断：输出最终合并后的 cookie key 集合（不含 value）
    let mut merged_keys: Vec<String> = all_cookies.keys().cloned().collect();
    merged_keys.sort();

    // Reconstruct cookie string
    let result = all_cookies.iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ");

    tracing::info!(
        "merged {} unique cookies from {} domains: {:?}",
        all_cookies.len(),
        cookie_domains.len(),
        merged_keys
    );
    result
}

/// Extract cookies from the webview. On Linux, uses webkit2gtk CookieManager
/// to read HttpOnly cookies. On other platforms, returns empty (safe failure).
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
        tracing::warn!("webkit cookie extraction returned empty, login may require manual retry");
        return String::new();
    }

    #[cfg(not(target_os = "linux"))]
    {
        tracing::warn!(
            "Cookie extraction not supported on this platform ({}), please use manual cookie input",
            std::env::consts::OS
        );
        String::new()
    }
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
    let domain_for_log = domain.clone();
    // 代码审查 Minor#5：预先构建 HashSet，避免多次 keys.iter().any() 的 O(N×M)。
    let key_set: std::collections::HashSet<String> = essential_keys.iter().map(|s| s.to_string()).collect();

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
                                tracing::debug!("webkit found {} total cookies for domain {}", cookies.len(), domain_for_log);
                                let mut matched_keys = Vec::new();
                                let mut cookie_name_set: Vec<String> = Vec::new();

                                for c in cookies.iter_mut() {
                                    if let Some(name) = c.name() {
                                        // Log cookie name and domain for debugging
                                        let cookie_domain = c.domain().map(|d| d.to_string()).unwrap_or_else(|| "none".to_string());
                                        cookie_name_set.push(format!(
                                            "{}(domain={}, httponly={}, secure={})",
                                            name,
                                            cookie_domain,
                                            c.is_http_only(),
                                            c.is_secure()
                                        ));
                                        tracing::debug!("cookie available: {} (domain={}, httponly={}, secure={})",
                                            name, cookie_domain, c.is_http_only(), c.is_secure());

                                        if let Some(value) = c.value() {
                                            if !value.is_empty() && key_set.contains(name.as_str()) {
                                                matched_keys.push(name.to_string());
                                            }
                                        }
                                    }
                                }

                                // 任务 B.1：每个 URI 的 cookie 名称集合（含属性），仅用于诊断；严禁输出 value。
                                cookie_name_set.sort();
                                tracing::debug!(
                                    "webkit cookie name set for domain {} (values omitted): {:?}",
                                    domain_for_log,
                                    cookie_name_set
                                );
                                tracing::debug!("matched {} essential cookies: {:?}", matched_keys.len(), matched_keys);

                                // Filter and deduplicate: only return essential cookies
                                // This prevents same-name cookie conflicts and reduces auth failures
                                let mut essential_cookies: std::collections::HashMap<String, String> = std::collections::HashMap::new();

                                for c in cookies.iter_mut() {
                                    if let (Some(name), Some(value)) = (c.name(), c.value()) {
                                        if !value.is_empty() && key_set.contains(name.as_str()) {
                                            // Deduplicate by name (last one wins)
                                            essential_cookies.insert(name.to_string(), value.to_string());
                                        }
                                    }
                                }

                                if essential_cookies.is_empty() {
                                    tracing::warn!("no essential cookies found, returning empty string");
                                    String::new()
                                } else {
                                    let result = essential_cookies.iter()
                                        .map(|(k, v)| format!("{k}={v}"))
                                        .collect::<Vec<_>>()
                                        .join("; ");
                                    tracing::debug!("returning {} essential cookies (deduplicated)", essential_cookies.len());
                                    result
                                }
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

    match tokio::time::timeout(COOKIE_EXTRACT_TIMEOUT, cookie_rx).await {
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

/// Linux-only: probe multiple domains for auth cookie (checks all domains, not just first).
/// Returns true if ANY domain has the auth key.
#[cfg(target_os = "linux")]
async fn probe_cookies_webkit_any(
    window: &tauri::WebviewWindow,
    cookie_domains: &[String],
    auth_key: &str,
) -> bool {
    // 代码审查 Major#2：只 probe 首域名可能漏判（cookie 可能落在其它域）。
    // 这里按顺序遍历，命中后短路返回 true。
    for domain in cookie_domains {
        if domain.trim().is_empty() {
            continue;
        }
        if probe_cookies_webkit(window, domain.as_str(), auth_key).await {
            return true;
        }
    }
    false
}

/// Linux-only: clear specified cookies for a specific domain.
/// Used before opening login window to prevent false positives from expired cookies.
#[cfg(target_os = "linux")]
async fn clear_cookies_webkit(
    window: &tauri::WebviewWindow,
    cookie_domain: &str,
    keys_to_clear: &[&str],
) {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let domain = cookie_domain.to_string();
    let domain_for_log = domain.clone();
    // 代码审查 Major#1：只清理最小集合，避免误删同域其它 cookie。
    let key_set: std::collections::HashSet<String> = keys_to_clear.iter().map(|s| s.to_string()).collect();
    let tx = std::sync::Mutex::new(Some(tx));

    let ok = window.with_webview(move |platform_wv| {
        use webkit2gtk::*;

        let webview: webkit2gtk::WebView = platform_wv.inner();
        let dm = webview.website_data_manager();
        let cm = dm.as_ref().and_then(|d| d.cookie_manager());
        if let Some(cm) = cm {
            // cookie_manager 是 GObject，clone 成本很低，避免在回调里反复从 dm 取。
            let cm_delete = cm.clone();
            let sender = tx.lock().ok().and_then(|mut g| g.take());
            // Get all cookies for this domain
            cm.cookies(
                &domain,
                gio::Cancellable::NONE,
                move |result: Result<Vec<soup::Cookie>, glib::Error>| {
                    if let Ok(mut cookies) = result {
                        let mut cleared_count = 0;
                        // Delete only specified cookies
                        for cookie in cookies.iter_mut() {
                            if let Some(name) = cookie.name() {
                                if key_set.contains(name.as_str()) {
                                    cm_delete.delete_cookie(cookie, gio::Cancellable::NONE, |_| {});
                                    cleared_count += 1;
                                }
                            }
                        }
                        tracing::debug!(
                            "cleared {} login-related cookies for domain {} (total cookies seen={})",
                            cleared_count,
                            domain_for_log,
                            cookies.len()
                        );
                    }
                    if let Some(sender) = sender {
                        let _ = sender.send(());
                    }
                },
            );
        } else {
            if let Some(sender) = tx.lock().ok().and_then(|mut g| g.take()) {
                let _ = sender.send(());
            }
        }
    });

    if let Err(e) = ok {
        tracing::warn!("clear_cookies_webkit with_webview failed: {e}");
        return;
    }

    // Wait for completion with timeout
    let _ = tokio::time::timeout(COOKIE_CLEAR_TIMEOUT, rx).await;
}

// --- Refresh token extraction (best-effort) ---

/// Best-effort extraction of refresh tokens from webview localStorage.
/// QQ Music web client sometimes stores refresh_key/refresh_token in localStorage.
/// Returns None if not found (this is expected for most login flows).
/// Note: Tauri v2 eval() is fire-and-forget; this uses a callback-based approach.
async fn extract_refresh_from_webview(
    window: &tauri::WebviewWindow,
) -> Option<(String, String)> {
    // Inject JS that posts refresh tokens back via a custom URL scheme.
    // Since Tauri v2 eval() doesn't return values, we use a localStorage scan
    // and navigate to a callback URL with the data.
    let js = concat!(
        "(function(){try{",
        "var rk=localStorage.getItem('refresh_key')||localStorage.getItem('music.login.refresh_key')||'';",
        "var rt=localStorage.getItem('refresh_token')||localStorage.getItem('music.login.refresh_token')||'';",
        "if(rk&&rt){document.title='__refresh__'+rk+'__sep__'+rt;}",
        "}catch(e){}})();"
    );

    if let Err(e) = window.eval(js) {
        tracing::debug!("localStorage eval failed (expected on some platforms): {e}");
        return None;
    }

    // Small delay for JS execution
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Try to read the title back
    match window.title() {
        Ok(title) if title.starts_with("__refresh__") => {
            let data = &title["__refresh__".len()..];
            if let Some((rk, rt)) = data.split_once("__sep__") {
                if !rk.is_empty() && !rt.is_empty() {
                    return Some((rk.to_string(), rt.to_string()));
                }
            }
        }
        _ => {}
    }

    None
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
        tracing::warn!("cover image too large: {w}x{h}");
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
        tracing::debug!("no colorful pixels found, falling back to average color");
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
            tracing::warn!("cover url rejected (not in allowlist): {upgraded}");
            return Err(IpcError::InvalidInput("url not in cover domain allowlist".into()));
        }
        let resp = http.get(parsed.clone())
            .send().await
            .map_err(|e| {
                tracing::warn!("cover fetch failed for {upgraded}: {e}");
                IpcError::Network(format!("fetch failed: {e}"))
            })?;
        if !resp.status().is_success() {
            tracing::warn!("cover fetch returned http {} for {upgraded}", resp.status());
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
            tracing::warn!("cover response is not a valid image ({} bytes) for {upgraded}", bytes.len());
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

