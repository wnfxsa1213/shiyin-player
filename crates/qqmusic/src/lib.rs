use std::sync::RwLock;
use std::time::Duration;

use async_trait::async_trait;
use rustplayer_core::{
    AuthToken, Credentials, CookieStorage, LyricsLine, MusicSource, MusicSourceId, Playlist, PlaylistBrief,
    SearchQuery, SourceError, StreamInfo, Track,
};

pub mod api;
pub mod sign;

/// Stored refresh tokens for credential refresh.
#[derive(Debug, Clone)]
pub struct RefreshInfo {
    pub refresh_key: String,
    pub refresh_token: String,
}

pub struct QqMusicClient {
    http: reqwest::Client,
    base_url: String,
    guid: String,
    cookie: RwLock<Option<String>>,
    refresh_info: RwLock<Option<RefreshInfo>>,
    on_refresh: RwLock<Option<Box<dyn Fn(RefreshInfo, String) + Send + Sync>>>,
}

impl QqMusicClient {
    pub fn new() -> Result<Self, SourceError> {
        let http = reqwest::Client::builder()
            .cookie_store(true)
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| SourceError::Internal(format!("failed to build http client: {e}")))?;
        Ok(Self {
            http,
            base_url: "https://u.y.qq.com".into(),
            guid: sign::generate_guid(),
            cookie: RwLock::new(None),
            refresh_info: RwLock::new(None),
            on_refresh: RwLock::new(None),
        })
    }

    /// Store refresh tokens for later credential refresh.
    pub fn set_refresh_info(&self, info: RefreshInfo) {
        if let Ok(mut guard) = self.refresh_info.write() {
            *guard = Some(info);
        }
    }

    /// Get current refresh info (if available).
    pub fn get_refresh_info(&self) -> Option<RefreshInfo> {
        self.refresh_info.read().ok().and_then(|g| g.clone())
    }

    /// Set a callback invoked after successful credential refresh.
    /// The callback receives the new RefreshInfo and the updated cookie string,
    /// allowing the application layer to persist them to durable storage.
    pub fn set_on_refresh<F: Fn(RefreshInfo, String) + Send + Sync + 'static>(&self, f: F) {
        if let Ok(mut guard) = self.on_refresh.write() {
            *guard = Some(Box::new(f));
        }
    }

    /// Attempt to refresh expired credentials.
    /// Returns true if refresh succeeded and cookie was updated.
    async fn try_refresh(&self) -> bool {
        let cookie = match self.cookie() {
            Some(c) => c,
            None => return false,
        };
        let refresh = match self.get_refresh_info() {
            Some(r) => r,
            None => {
                log::debug!("qqmusic try_refresh: no refresh_info available, skipping");
                return false;
            }
        };

        log::info!("qqmusic try_refresh: attempting credential refresh");
        match api::refresh_credentials(
            &self.http, &self.base_url, &cookie,
            &refresh.refresh_key, &refresh.refresh_token,
        ).await {
            Ok(new_cred) => {
                // Rebuild cookie with new musickey
                let new_cookie = api::rebuild_cookie(&cookie, &new_cred.musickey, &new_cred.musicid);
                let new_refresh = RefreshInfo {
                    refresh_key: new_cred.refresh_key,
                    refresh_token: new_cred.refresh_token,
                };

                // Update stored cookie
                if let Ok(mut guard) = self.cookie.write() {
                    *guard = Some(new_cookie.clone());
                    log::info!("qqmusic try_refresh: cookie updated successfully");
                }

                // Notify application layer to persist refreshed credentials
                if let Ok(guard) = self.on_refresh.read() {
                    if let Some(cb) = guard.as_ref() {
                        cb(new_refresh.clone(), new_cookie);
                    }
                }

                // Update refresh info in memory
                self.set_refresh_info(new_refresh);
                true
            }
            Err(e) => {
                log::warn!("qqmusic try_refresh: refresh failed: {e}");
                false
            }
        }
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
        let result = api::search(&self.http, &self.base_url, query.clone(), &self.guid, self.cookie().as_deref()).await;
        if matches!(result, Err(SourceError::Unauthorized)) && self.try_refresh().await {
            return api::search(&self.http, &self.base_url, query, &self.guid, self.cookie().as_deref()).await;
        }
        result
    }
    async fn get_stream_url(&self, track: &Track) -> Result<StreamInfo, SourceError> {
        let result = api::song_url(&self.http, &self.base_url, &track.id, track.media_mid.as_deref(), &self.guid, self.cookie().as_deref()).await;
        if matches!(result, Err(SourceError::Unauthorized)) && self.try_refresh().await {
            return api::song_url(&self.http, &self.base_url, &track.id, track.media_mid.as_deref(), &self.guid, self.cookie().as_deref()).await;
        }
        result
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
                // Use lightweight GetLoginUserInfo for validation instead of heavy user_playlists
                log::info!("qqmusic login: validating cookie via GetLoginUserInfo (len={})", cookie.len());
                api::validate_login(&self.http, &self.base_url, &cookie).await?;
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
        let result = api::user_playlists(&self.http, &self.base_url, cookie.as_deref()).await;
        if matches!(result, Err(SourceError::Unauthorized)) && self.try_refresh().await {
            return api::user_playlists(&self.http, &self.base_url, self.cookie().as_deref()).await;
        }
        result
    }
    async fn get_playlist_detail(&self, id: &str) -> Result<Playlist, SourceError> {
        let result = api::playlist_detail(&self.http, &self.base_url, id, self.cookie().as_deref()).await;
        if matches!(result, Err(SourceError::Unauthorized)) && self.try_refresh().await {
            return api::playlist_detail(&self.http, &self.base_url, id, self.cookie().as_deref()).await;
        }
        result
    }
    fn logout(&self) {
        if let Ok(mut guard) = self.cookie.write() {
            *guard = None;
        }
        if let Ok(mut guard) = self.refresh_info.write() {
            *guard = None;
        }
    }
    fn is_logged_in(&self) -> bool {
        self.cookie.read().ok().map_or(false, |g| g.is_some())
    }
}
