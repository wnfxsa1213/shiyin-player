use std::sync::RwLock;
use std::time::Duration;

use async_trait::async_trait;
use rustplayer_core::{
    AuthToken, Credentials, CookieStorage, LyricsLine, MusicSource, MusicSourceId, Playlist, PlaylistBrief,
    SearchQuery, SourceError, StreamInfo, Track,
};

pub mod api;
pub mod sign;

pub struct QqMusicClient {
    http: reqwest::Client,
    base_url: String,
    guid: String,
    cookie: RwLock<Option<String>>,
}

impl QqMusicClient {
    pub fn new() -> Result<Self, SourceError> {
        let http = reqwest::Client::builder()
            .cookie_store(true)
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| SourceError::Internal(format!("failed to build http client: {e}")))?;
        Ok(Self {
            http,
            base_url: "https://u.y.qq.com".into(),
            guid: sign::generate_guid(),
            cookie: RwLock::new(None),
        })
    }
}

impl CookieStorage for QqMusicClient {
    fn cookie_lock(&self) -> &RwLock<Option<String>> {
        &self.cookie
    }
}

#[async_trait]
impl MusicSource for QqMusicClient {
    fn id(&self) -> MusicSourceId { MusicSourceId::Qqmusic }
    fn name(&self) -> &'static str { "QQ音乐" }

    async fn search(&self, query: SearchQuery) -> Result<Vec<Track>, SourceError> {
        api::search(&self.http, &self.base_url, query, &self.guid, self.cookie().as_deref()).await
    }
    async fn get_stream_url(&self, track_id: &str) -> Result<StreamInfo, SourceError> {
        api::song_url(&self.http, &self.base_url, track_id, &self.guid, self.cookie().as_deref()).await
    }
    async fn get_lyrics(&self, track_id: &str) -> Result<Vec<LyricsLine>, SourceError> {
        api::lyrics(&self.http, track_id).await
    }
    async fn get_album_art(&self, track_id: &str) -> Result<Option<String>, SourceError> {
        let q = SearchQuery { keyword: track_id.to_string(), limit: Some(1), offset: Some(0) };
        let mut tracks = api::search(&self.http, &self.base_url, q, &self.guid, self.cookie().as_deref()).await?;
        Ok(tracks.pop().and_then(|t| t.cover_url))
    }
    async fn login(&self, credentials: Credentials) -> Result<AuthToken, SourceError> {
        match credentials {
            Credentials::Cookie { cookie } | Credentials::Token { token: cookie } => {
                if cookie.contains('\r') || cookie.contains('\n') || cookie.len() > 4096 {
                    return Err(SourceError::InvalidResponse("invalid cookie".into()));
                }
                // Validate cookie first before storing it
                log::info!("qqmusic login: validating cookie by calling user_playlists API (len={})", cookie.len());
                api::user_playlists(&self.http, &self.base_url, Some(&cookie)).await?;
                log::info!("qqmusic login: cookie validation succeeded");

                // Only store cookie after successful validation
                match self.cookie.write() {
                    Ok(mut guard) => {
                        *guard = Some(cookie.clone());
                        log::info!("qqmusic login: cookie stored successfully");
                    }
                    Err(e) => {
                        log::error!("qqmusic login: failed to acquire write lock: {e}");
                        return Err(SourceError::Internal("failed to set cookie".into()));
                    }
                }

                Ok(AuthToken { access_token: cookie, expires_at: None })
            }
            Credentials::Password { .. } => Err(SourceError::Unimplemented),
        }
    }
    async fn get_user_playlists(&self) -> Result<Vec<PlaylistBrief>, SourceError> {
        let cookie = self.cookie();
        log::info!("qqmusic get_user_playlists: cookie present = {}", cookie.is_some());
        if let Some(ref c) = cookie {
            log::debug!("qqmusic get_user_playlists: cookie length = {}", c.len());
        }
        api::user_playlists(&self.http, &self.base_url, cookie.as_deref()).await
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
