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
    Loading { track: Track },
    Playing { track: Track, position_ms: u64 },
    Paused { track: Track, position_ms: u64 },
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
    Spectrum { magnitudes: Vec<f32> },
    Error { error: PlayerError },
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

#[async_trait]
pub trait MusicSource: Send + Sync {
    fn id(&self) -> MusicSourceId;
    fn name(&self) -> &'static str;
    async fn search(&self, query: SearchQuery) -> Result<Vec<Track>, SourceError>;
    async fn get_stream_url(&self, track_id: &str) -> Result<StreamInfo, SourceError>;
    async fn get_lyrics(&self, track_id: &str) -> Result<Vec<LyricsLine>, SourceError>;
    async fn get_album_art(&self, track_id: &str) -> Result<Option<String>, SourceError>;
    async fn login(&self, credentials: Credentials) -> Result<AuthToken, SourceError>;
    async fn get_user_playlists(&self) -> Result<Vec<PlaylistBrief>, SourceError> {
        Err(SourceError::Unimplemented)
    }
    async fn get_playlist_detail(&self, _id: &str) -> Result<Playlist, SourceError> {
        Err(SourceError::Unimplemented)
    }
}
