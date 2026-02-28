use std::sync::RwLock;
use std::time::Duration;

use async_trait::async_trait;
use rustplayer_core::{
    AuthToken, Credentials, CookieStorage, LyricsLine, MusicSource, MusicSourceId, Playlist, PlaylistBrief,
    SearchQuery, SourceError, StreamInfo, Track,
};

pub mod api;
pub mod crypto;

pub struct NeteaseClient {
    http: reqwest::Client,
    base_url: String,
    cookie: RwLock<Option<String>>,
}

impl NeteaseClient {
    pub fn new() -> Result<Self, SourceError> {
        let http = reqwest::Client::builder()
            .cookie_store(true)
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| SourceError::Internal(format!("failed to build http client: {e}")))?;
        Ok(Self {
            http,
            base_url: "https://music.163.com".into(),
            cookie: RwLock::new(None),
        })
    }
}

impl CookieStorage for NeteaseClient {
    fn cookie_lock(&self) -> &RwLock<Option<String>> {
        &self.cookie
    }
}

#[async_trait]
impl MusicSource for NeteaseClient {
    fn id(&self) -> MusicSourceId { MusicSourceId::Netease }
    fn name(&self) -> &'static str { "网易云音乐" }

    async fn search(&self, query: SearchQuery) -> Result<Vec<Track>, SourceError> {
        api::search(&self.http, &self.base_url, query, self.cookie().as_deref()).await
    }
    async fn get_stream_url(&self, track_id: &str) -> Result<StreamInfo, SourceError> {
        api::song_url(&self.http, &self.base_url, track_id, self.cookie().as_deref()).await
    }
    async fn get_lyrics(&self, track_id: &str) -> Result<Vec<LyricsLine>, SourceError> {
        api::lyrics(&self.http, &self.base_url, track_id, self.cookie().as_deref()).await
    }
    async fn get_album_art(&self, track_id: &str) -> Result<Option<String>, SourceError> {
        api::album_art(&self.http, &self.base_url, track_id, self.cookie().as_deref()).await
    }
    async fn login(&self, credentials: Credentials) -> Result<AuthToken, SourceError> {
        match credentials {
            Credentials::Cookie { cookie } | Credentials::Token { token: cookie } => {
                if cookie.contains('\r') || cookie.contains('\n') || cookie.len() > 4096 {
                    return Err(SourceError::InvalidResponse("invalid cookie".into()));
                }
                if let Ok(mut guard) = self.cookie.write() {
                    *guard = Some(cookie.clone());
                }
                Ok(AuthToken { access_token: cookie, expires_at: None })
            }
            Credentials::Password { .. } => Err(SourceError::Unimplemented),
        }
    }
    async fn get_user_playlists(&self) -> Result<Vec<PlaylistBrief>, SourceError> {
        api::user_playlists(&self.http, &self.base_url, self.cookie().as_deref()).await
    }
    async fn get_playlist_detail(&self, id: &str) -> Result<Playlist, SourceError> {
        api::playlist_detail(&self.http, &self.base_url, id, self.cookie().as_deref()).await
    }
    fn logout(&self) {
        if let Ok(mut guard) = self.cookie.write() {
            *guard = None;
        }
    }
    fn is_logged_in(&self) -> bool {
        self.cookie.read().ok().map_or(false, |g| g.is_some())
    }
}
