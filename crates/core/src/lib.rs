use std::sync::Arc;
use std::sync::RwLock;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type TrackId = String;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MusicSourceId {
    Netease,
    Qqmusic,
}

impl MusicSourceId {
    /// Returns the display name for UI presentation (e.g., "网易云音乐", "QQ音乐")
    pub fn display_name(&self) -> &'static str {
        match self {
            MusicSourceId::Netease => "网易云音乐",
            MusicSourceId::Qqmusic => "QQ音乐",
        }
    }

    /// Returns the storage key for database and configuration (e.g., "netease", "qqmusic")
    pub fn storage_key(&self) -> &'static str {
        match self {
            MusicSourceId::Netease => "netease",
            MusicSourceId::Qqmusic => "qqmusic",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: TrackId,
    pub name: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub source: MusicSourceId,
    pub cover_url: Option<String>,
    /// QQ Music only: the media file ID used for vkey filename construction.
    /// Differs from `id` (songmid) for many tracks. Falls back to `id` when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_mid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamInfo {
    pub url: String,
    pub format: String,
    pub bitrate: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricsLine {
    pub time_ms: u64,
    pub text: String,
    pub translation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PlayerState {
    Idle,
    Loading { track: Arc<Track> },
    Playing { track: Arc<Track>, position_ms: u64 },
    Paused { track: Arc<Track>, position_ms: u64 },
    Buffering { track: Arc<Track>, percent: i32 },
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PlayerCommand {
    Load(Track, StreamInfo),
    Play,
    Pause,
    Toggle,
    Stop,
    Seek(u64),
    SetVolume(f32),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum PlayerEvent {
    StateChanged { state: PlayerState },
    Progress { position_ms: u64, duration_ms: u64 },
    Spectrum { magnitudes: Arc<[f32]> },
    Error { error: PlayerError },
    Buffering { percent: i32 },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchQuery {
    pub keyword: String,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Credentials {
    Password { username: String, password: String },
    Cookie { cookie: String },
    Token { token: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthToken {
    pub access_token: String,
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistBrief {
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
    pub track_count: u32,
    pub source: MusicSourceId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub tracks: Vec<Track>,
    pub source: MusicSourceId,
}

// --- Recommendation Types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayEvent {
    pub track_id: TrackId,
    pub source: MusicSourceId,
    pub artist: String,
    pub album: String,
    pub track_duration_ms: u64,
    pub played_duration_ms: u64,
    pub started_at: i64,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistPreference {
    pub artist: String,
    pub play_count: u32,
    pub avg_completion_rate: f64,
    pub last_played_at: i64,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendResult {
    pub personalized: Vec<Track>,
    pub top_artists: Vec<ArtistPreference>,
    pub rediscover: Vec<Track>,
}

// --- Errors ---

#[derive(Debug, Clone, Serialize, Deserialize, Error)]
pub enum SourceError {
    #[error("network error: {0}")]
    Network(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("not found")]
    NotFound,
    #[error("rate limited")]
    RateLimited,
    #[error("invalid response: {0}")]
    InvalidResponse(String),
    #[error("payment required")]
    PaymentRequired,
    #[error("unimplemented")]
    Unimplemented,
    #[error("{0}")]
    Internal(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Error)]
pub enum PlayerError {
    #[error("invalid state: {0}")]
    InvalidState(String),
    #[error("pipeline error: {0}")]
    Pipeline(String),
    #[error("stream error: {0}")]
    Stream(String),
    #[error("channel closed")]
    ChannelClosed,
    #[error("{0}")]
    Internal(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Error)]
pub enum AppError {
    #[error("source: {0}")]
    Source(#[from] SourceError),
    #[error("player: {0}")]
    Player(#[from] PlayerError),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("{0}")]
    Internal(String),
}

// --- MusicSource Trait ---

/// Helper trait for managing cookie storage in music source implementations.
/// Provides a default implementation for retrieving cookies from RwLock storage.
/// Uses `Arc<str>` internally to avoid cloning cookie strings on every API call.
pub trait CookieStorage {
    /// Returns the RwLock containing the optional cookie.
    fn cookie_lock(&self) -> &RwLock<Option<Arc<str>>>;

    /// Retrieves the current cookie value, if available.
    /// Returns None if the lock is poisoned or no cookie is set.
    /// Clone cost is an atomic increment (Arc), not a string allocation.
    fn cookie(&self) -> Option<Arc<str>> {
        self.cookie_lock().read().ok().and_then(|v| v.clone())
    }
}

#[async_trait]
pub trait MusicSource: Send + Sync {
    fn id(&self) -> MusicSourceId;
    fn name(&self) -> &'static str;
    async fn search(&self, query: SearchQuery) -> Result<Vec<Track>, SourceError>;
    async fn get_stream_url(&self, track: &Track) -> Result<StreamInfo, SourceError>;
    async fn get_lyrics(&self, track_id: &str) -> Result<Vec<LyricsLine>, SourceError>;
    async fn get_album_art(&self, track_id: &str) -> Result<Option<String>, SourceError>;
    async fn login(&self, credentials: Credentials) -> Result<AuthToken, SourceError>;
    async fn get_user_playlists(&self) -> Result<Vec<PlaylistBrief>, SourceError> {
        Err(SourceError::Unimplemented)
    }
    async fn get_playlist_detail(&self, _id: &str) -> Result<Playlist, SourceError> {
        Err(SourceError::Unimplemented)
    }
    async fn get_daily_recommend(&self) -> Result<Vec<Track>, SourceError> {
        Err(SourceError::Unimplemented)
    }
    async fn get_personal_fm(&self) -> Result<Vec<Track>, SourceError> {
        Err(SourceError::Unimplemented)
    }
    fn logout(&self) {}
    fn is_logged_in(&self) -> bool { false }
}
