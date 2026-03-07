#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod events;
mod logging;
mod store;
mod trace_ctx;

use std::sync::Arc;
use std::time::Duration;
use rustplayer_core::{Credentials, MusicSourceId};
use rustplayer_player::Player;
use rustplayer_sources::SourceRegistry;
use rustplayer_netease::NeteaseClient;
use rustplayer_qqmusic::QqMusicClient;
use rustplayer_cache::SearchCache;
use tauri::Manager;

fn main() {
    let ctx = tauri::generate_context!();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::search_music,
            commands::play_track,
            commands::toggle_playback,
            commands::seek,
            commands::set_volume,
            commands::get_lyrics,
            commands::login,
            commands::logout,
            commands::open_login_window,
            commands::check_login_status,
            commands::get_user_playlists,
            commands::get_playlist_detail,
            commands::get_daily_recommend,
            commands::get_personal_fm,
            commands::extract_cover_color,
            commands::client_log,
        ])
        .setup(|app| {
            // Resolve app data dir first; logging needs it for file output.
            let app_data_dir = app.path().app_data_dir().unwrap_or_else(|e| {
                eprintln!("failed to resolve app data directory: {e}");
                std::process::exit(1);
            });

            logging::init(&app_data_dir).unwrap_or_else(|e| {
                eprintln!("failed to initialize logging: {e}");
                std::process::exit(1);
            });

            let player = Arc::new(Player::new().unwrap_or_else(|e| {
                tracing::error!("failed to initialize audio player: {e}");
                std::process::exit(1);
            }));

            // Create QqMusicClient first, load refresh info, then register
            let qqmusic_client = QqMusicClient::new().unwrap_or_else(|e| {
                tracing::error!("failed to create qqmusic client: {e}");
                std::process::exit(1);
            });

            // Load persisted refresh info into QqMusicClient (for auto-refresh on 401)
            match store::load_refresh_info(&app.handle(), MusicSourceId::Qqmusic) {
                Ok(Some((rk, rt))) => {
                    tracing::info!("loaded qqmusic refresh info (refresh_key len={}, refresh_token len={})", rk.len(), rt.len());
                    qqmusic_client.set_refresh_info(rustplayer_qqmusic::RefreshInfo {
                        refresh_key: rk,
                        refresh_token: rt,
                    });
                }
                Ok(None) => {
                    tracing::debug!("no qqmusic refresh info in store");
                }
                Err(e) => tracing::warn!("load refresh info failed: {e}"),
            }

            // Persist refreshed credentials to store when auto-refresh succeeds
            let app_handle_for_refresh = app.handle().clone();
            qqmusic_client.set_on_refresh(move |info, cookie| {
                tracing::info!(
                    "auto-refresh succeeded, persisting credentials (refresh_key len={}, refresh_token len={})",
                    info.refresh_key.len(), info.refresh_token.len()
                );
                if let Err(e) = store::save_refresh_info(
                    &app_handle_for_refresh, MusicSourceId::Qqmusic,
                    &info.refresh_key, &info.refresh_token,
                ) {
                    tracing::warn!("failed to persist refresh info after auto-refresh: {e}");
                }
                if let Err(e) = store::save_cookie(&app_handle_for_refresh, MusicSourceId::Qqmusic, &cookie) {
                    tracing::warn!("failed to persist cookie after auto-refresh: {e}");
                }
            });

            let mut registry = SourceRegistry::new();
            registry.register(Arc::new(NeteaseClient::new().unwrap_or_else(|e| {
                tracing::error!("failed to create netease client: {e}");
                std::process::exit(1);
            })));
            registry.register(Arc::new(qqmusic_client));
            let registry = Arc::new(registry);

            let cache = Arc::new(SearchCache::new());

            // Shared reqwest client for cover image fetching (connection pool reuse)
            let cover_http = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    // Allow up to 3 redirects, but only to whitelisted cover CDN domains
                    if attempt.previous().len() >= 3 {
                        return attempt.stop();
                    }
                    let url = attempt.url();
                    let host = match url.host_str() {
                        Some(h) => h,
                        None => return attempt.stop(),
                    };
                    const ALLOWED: &[&str] = &[
                        "music.126.net", "p1.music.126.net", "p2.music.126.net",
                        "p3.music.126.net", "p4.music.126.net",
                        "y.gtimg.cn", "imgcache.qq.com", "y.qq.com", "qqmusic.qq.com",
                    ];
                    let ok = ALLOWED.iter().any(|a| host == *a || host.ends_with(&format!(".{a}")));
                    if ok { attempt.follow() } else { attempt.stop() }
                }))
                .build()
                .unwrap_or_else(|e| {
                    tracing::error!("failed to build cover http client: {e}");
                    std::process::exit(1);
                });

            app.manage(player.clone());
            app.manage(registry.clone());
            app.manage(cache);
            app.manage(cover_http);

            events::spawn_event_forwarder(app.handle().clone(), &player);
            let database = db::Db::open(app_data_dir).unwrap_or_else(|e| {
                tracing::error!("failed to open SQLite database: {e}");
                std::process::exit(1);
            });
            let database = Arc::new(database);
            app.manage(database.clone());

            // Periodic cache cleanup (hourly, with immediate first run)
            let db_for_cleanup = database.clone();
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(3600));
                loop {
                    ticker.tick().await;
                    let db = db_for_cleanup.clone();
                    match tokio::task::spawn_blocking(move || db.purge_expired()).await {
                        Ok(Ok(())) => tracing::info!("periodic cache cleanup completed"),
                        Ok(Err(e)) => tracing::warn!("periodic cache cleanup failed: {e}"),
                        Err(e) => tracing::warn!("periodic cache cleanup task panicked: {e}"),
                    }
                }
            });

            // Restore cookies on startup
            let registry_clone = registry.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                for source_id in [MusicSourceId::Netease, MusicSourceId::Qqmusic] {
                    match store::load_cookie(&app_handle, source_id) {
                        Ok(Some(cookie)) => {
                            if let Some(src) = registry_clone.get(source_id) {
                                let creds = Credentials::Cookie { cookie };
                                if let Err(e) = src.login(creds).await {
                                    tracing::warn!("restore cookie login failed for {source_id:?}: {e}");
                                }
                            }
                        }
                        Ok(None) => {}
                        Err(e) => tracing::warn!("load_cookie failed for {source_id:?}: {e}"),
                    }
                }
            });

            Ok(())
        })
        .run(ctx)
        .expect("error running tauri application");
}
