#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod events;
mod store;

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
    let player = Player::new().unwrap_or_else(|e| {
        eprintln!("fatal: failed to initialize audio player: {e}");
        std::process::exit(1);
    });
    let player = Arc::new(player);
    let mut registry = SourceRegistry::new();
    registry.register(Arc::new(NeteaseClient::new()));
    registry.register(Arc::new(QqMusicClient::new()));
    let registry = Arc::new(registry);
    let cache = Arc::new(SearchCache::new());

    // Shared reqwest client for cover image fetching (connection pool reuse)
    let cover_http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .expect("failed to build cover http client");

    let player_for_events = player.clone();
    let registry_for_setup = registry.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(player)
        .manage(registry)
        .manage(cache)
        .manage(cover_http)
        .invoke_handler(tauri::generate_handler![
            commands::search_music,
            commands::play_track,
            commands::toggle_playback,
            commands::seek,
            commands::set_volume,
            commands::get_lyrics,
            commands::login,
            commands::logout,
            commands::get_user_playlists,
            commands::get_playlist_detail,
            commands::extract_cover_color,
        ])
        .setup(move |app| {
            events::spawn_event_forwarder(app.handle().clone(), &player_for_events);

            // Initialize SQLite cache
            let app_data_dir = app.path().app_data_dir().unwrap_or_else(|e| {
                eprintln!("fatal: failed to resolve app data directory: {e}");
                std::process::exit(1);
            });
            let database = db::Db::open(app_data_dir).unwrap_or_else(|e| {
                eprintln!("fatal: failed to open SQLite database: {e}");
                std::process::exit(1);
            });
            app.manage(Arc::new(database));

            // Restore cookies on startup
            let registry_clone = registry_for_setup.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                for source_id in [MusicSourceId::Netease, MusicSourceId::Qqmusic] {
                    if let Ok(Some(cookie)) = store::load_cookie(&app_handle, source_id) {
                        if let Some(src) = registry_clone.get(source_id) {
                            let creds = Credentials::Cookie { cookie };
                            let _ = src.login(creds).await;
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
