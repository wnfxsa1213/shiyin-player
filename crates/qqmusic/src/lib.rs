use std::sync::RwLock;
use std::time::Duration;

use async_trait::async_trait;
use rustplayer_core::{
    AuthToken, Credentials, LyricsLine, MusicSource, MusicSourceId, SearchQuery,
    SourceError, StreamInfo, Track,
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
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .cookie_store(true)
                .timeout(Duration::from_secs(5))
                .build()
                .expect("failed to build http client"),
            base_url: "https://u.y.qq.com".into(),
            guid: sign::generate_guid(),
            cookie: RwLock::new(None),
        }
    }

    fn cookie(&self) -> Option<String> {
        self.cookie.read().ok().and_then(|v| v.clone())
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
                if let Ok(mut guard) = self.cookie.write() {
                    *guard = Some(cookie.clone());
                }
                Ok(AuthToken { access_token: cookie, expires_at: None })
            }
            Credentials::Password { .. } => Err(SourceError::Unimplemented),
        }
    }
}
