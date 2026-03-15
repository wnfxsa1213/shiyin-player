use std::path::PathBuf;
use std::time::Duration;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::collections::HashSet;
use rustplayer_core::{ArtistPreference, LyricsLine, MusicSourceId, PlayEvent, Track};

const CACHE_TTL_SECS: i64 = 24 * 3600; // 1 day
const DB_CONNECTION_TIMEOUT: Duration = Duration::from_secs(5);

pub struct Db {
    pool: Pool<SqliteConnectionManager>,
}

impl Db {
    pub fn open(app_data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        let db_path = app_data_dir.join("rustplayer.db");
        let manager = SqliteConnectionManager::file(db_path)
            .with_init(|c| c.execute_batch("PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;"));
        let pool = Pool::builder()
            .max_size(12)
            .build(manager)
            .map_err(|e| e.to_string())?;

        // Enable WAL mode and initialize tables
        {
            let conn = pool.get().map_err(|e| e.to_string())?;
            conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS tracks (
                    id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    name TEXT NOT NULL,
                    artist TEXT NOT NULL,
                    album TEXT NOT NULL,
                    duration_ms INTEGER NOT NULL,
                    cover_url TEXT,
                    search_keyword TEXT NOT NULL,
                    cached_at INTEGER NOT NULL,
                    PRIMARY KEY (id, source, search_keyword)
                );
                CREATE INDEX IF NOT EXISTS idx_tracks_cached_at ON tracks(cached_at);
                CREATE INDEX IF NOT EXISTS idx_tracks_source_keyword ON tracks(source, search_keyword, cached_at);
                CREATE TABLE IF NOT EXISTS lyrics (
                    track_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    lines_json TEXT NOT NULL,
                    cached_at INTEGER NOT NULL,
                    PRIMARY KEY (track_id, source)
                );
                CREATE INDEX IF NOT EXISTS idx_lyrics_cached_at ON lyrics(cached_at);
                CREATE TABLE IF NOT EXISTS play_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    track_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    artist TEXT NOT NULL,
                    album TEXT NOT NULL,
                    track_duration_ms INTEGER NOT NULL,
                    played_duration_ms INTEGER NOT NULL,
                    started_at INTEGER NOT NULL,
                    completed INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_play_events_artist ON play_events(artist);
                CREATE INDEX IF NOT EXISTS idx_play_events_started_at ON play_events(started_at);
                CREATE INDEX IF NOT EXISTS idx_play_events_track ON play_events(track_id, source);",
            ).map_err(|e| e.to_string())?;
            // Schema migration: add media_mid column if not yet present (QQ Music vkey fix).
            // Uses PRAGMA table_info to detect existing column instead of error string matching
            // (which would be fragile across SQLite/rusqlite versions).
            let media_mid_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name='media_mid'",
                [],
                |r| r.get(0),
            ).map_err(|e| format!("Failed to check schema: {}", e))?;
            if media_mid_count == 0 {
                conn.execute_batch("ALTER TABLE tracks ADD COLUMN media_mid TEXT;")
                    .map_err(|e| e.to_string())?;
            }
        }

        Ok(Self { pool })
    }

    pub fn purge_expired(&self) -> Result<(), String> {
        let now = now_epoch();
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let cutoff = now - CACHE_TTL_SECS;
        conn.execute("DELETE FROM tracks WHERE cached_at <= ?1", rusqlite::params![cutoff])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM lyrics WHERE cached_at <= ?1", rusqlite::params![cutoff])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn cache_tracks(&self, source: MusicSourceId, keyword: &str, tracks: &[Track]) -> Result<(), String> {
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let now = now_epoch();
        let src = source.storage_key();
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT OR REPLACE INTO tracks (id, source, name, artist, album, duration_ms, cover_url, search_keyword, cached_at, media_mid)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
            ).map_err(|e| e.to_string())?;
            for t in tracks {
                stmt.execute(
                    rusqlite::params![t.id, src, t.name, t.artist, t.album, t.duration_ms, t.cover_url, keyword, now, t.media_mid],
                ).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_cached_tracks(&self, source: MusicSourceId, keyword: &str) -> Result<Option<Vec<Track>>, String> {
        let now = now_epoch();
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let cutoff = now - CACHE_TTL_SECS;
        let src = source.storage_key();
        let mut stmt = conn.prepare_cached(
            "SELECT id, name, artist, album, duration_ms, cover_url, media_mid FROM tracks
             WHERE source = ?1 AND search_keyword = ?2 AND cached_at > ?3
             ORDER BY rowid"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![src, keyword, cutoff], |row| {
            Ok(Track {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                duration_ms: row.get(4)?,
                source,
                cover_url: row.get(5)?,
                media_mid: row.get(6)?,
            })
        }).map_err(|e| e.to_string())?;
        let tracks: Vec<Track> = rows.filter_map(|r| match r {
            Ok(t) => Some(t),
            Err(e) => { log::warn!("db: corrupt track row: {e}"); None }
        }).collect();
        if tracks.is_empty() { Ok(None) } else { Ok(Some(tracks)) }
    }

    pub fn cache_lyrics(&self, track_id: &str, source: MusicSourceId, lines: &[LyricsLine]) -> Result<(), String> {
        let now = now_epoch();
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let json = serde_json::to_string(lines).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO lyrics (track_id, source, lines_json, cached_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![track_id, source.storage_key(), json, now],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_cached_lyrics(&self, track_id: &str, source: MusicSourceId) -> Result<Option<Vec<LyricsLine>>, String> {
        let now = now_epoch();
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let cutoff = now - CACHE_TTL_SECS;
        let mut stmt = conn.prepare_cached(
            "SELECT lines_json FROM lyrics WHERE track_id = ?1 AND source = ?2 AND cached_at > ?3"
        ).map_err(|e| e.to_string())?;
        let result: Option<String> = match stmt.query_row(
            rusqlite::params![track_id, source.storage_key(), cutoff],
            |row| row.get(0),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => { log::warn!("db: lyrics query error: {e}"); None }
        };
        match result {
            Some(json) => {
                let lines: Vec<LyricsLine> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
                Ok(Some(lines))
            }
            None => Ok(None),
        }
    }

    // --- Recommendation: Play Event Tracking ---

    pub fn record_play_event(&self, event: &PlayEvent) -> Result<(), String> {
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        conn.execute(
            "INSERT INTO play_events (track_id, source, artist, album, track_duration_ms, played_duration_ms, started_at, completed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                event.track_id,
                event.source.storage_key(),
                event.artist,
                event.album,
                event.track_duration_ms,
                event.played_duration_ms,
                event.started_at,
                event.completed as i32,
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Aggregate play events by artist over the last `days` days.
    /// Returns top `limit` artists sorted by preference score.
    /// Score = play_count * avg_completion_rate * recency_factor.
    pub fn get_artist_stats(&self, days: u32, limit: u32) -> Result<Vec<ArtistPreference>, String> {
        let now = now_epoch();
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let cutoff = now - (days as i64 * 86400);
        let mut stmt = conn.prepare_cached(
            "SELECT
                artist,
                COUNT(*) as play_count,
                AVG(CASE WHEN track_duration_ms > 0
                    THEN CAST(played_duration_ms AS REAL) / track_duration_ms
                    ELSE 0.0 END) as avg_completion_rate,
                MAX(started_at) as last_played_at
             FROM play_events
             WHERE started_at > ?1
             GROUP BY artist
             ORDER BY play_count DESC
             LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![cutoff, limit], |row| {
            let play_count: u32 = row.get(1)?;
            let avg_completion_rate: f64 = row.get(2)?;
            let last_played_at: i64 = row.get(3)?;
            // Recency factor: 1.0 for today, decaying to 0.3 for oldest events
            let days_ago = ((now - last_played_at) as f64 / 86400.0).max(0.0);
            let recency = (1.0 - days_ago / (days as f64)).max(0.3);
            let score = play_count as f64 * avg_completion_rate.min(1.0) * recency;
            Ok(ArtistPreference {
                artist: row.get(0)?,
                play_count,
                avg_completion_rate: avg_completion_rate.min(1.0),
                last_played_at,
                score,
            })
        }).map_err(|e| e.to_string())?;
        let mut stats: Vec<ArtistPreference> = rows.filter_map(|r| match r {
            Ok(s) => Some(s),
            Err(e) => { log::warn!("db: corrupt artist stat row: {e}"); None }
        }).collect();
        // Re-sort by computed score (DB sorted by play_count, but score includes recency)
        stats.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        Ok(stats)
    }

    /// Get track IDs played within the last `hours` hours.
    /// Returns a set of (track_id, source_key) pairs for freshness filtering.
    pub fn get_recent_track_ids(&self, hours: u32) -> Result<HashSet<(String, String)>, String> {
        let now = now_epoch();
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let cutoff = now - (hours as i64 * 3600);
        let mut stmt = conn.prepare_cached(
            "SELECT DISTINCT track_id, source FROM play_events WHERE started_at > ?1"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![cutoff], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        let mut set = HashSet::new();
        for r in rows {
            if let Ok(pair) = r {
                set.insert(pair);
            }
        }
        Ok(set)
    }

    /// Get tracks that were played frequently in the past but not in the last `stale_days` days.
    /// Returns Track-like data from the search cache, up to `limit` items.
    pub fn get_stale_tracks(&self, stale_days: u32, limit: u32) -> Result<Vec<Track>, String> {
        let now = now_epoch();
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let stale_cutoff = now - (stale_days as i64 * 86400);
        // Find tracks with >= 2 plays total, whose most recent play is older than stale_cutoff.
        // Join with tracks cache to recover full Track metadata.
        let mut stmt = conn.prepare_cached(
            "SELECT pe.track_id, pe.source, pe.artist, pe.album,
                    COALESCE(t.name, pe.artist || ' - Unknown') as name,
                    COALESCE(t.duration_ms, pe.track_duration_ms) as duration_ms,
                    t.cover_url, t.media_mid,
                    COUNT(*) as play_count, MAX(pe.started_at) as last_played
             FROM play_events pe
             LEFT JOIN tracks t ON t.id = pe.track_id AND t.source = pe.source
             GROUP BY pe.track_id, pe.source
             HAVING play_count >= 2 AND last_played < ?1
             ORDER BY play_count DESC
             LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![stale_cutoff, limit], |row| {
            let source_str: String = row.get(1)?;
            let source = match source_str.as_str() {
                "netease" => MusicSourceId::Netease,
                "qqmusic" => MusicSourceId::Qqmusic,
                _ => MusicSourceId::Netease,
            };
            Ok(Track {
                id: row.get(0)?,
                name: row.get(4)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                duration_ms: row.get(5)?,
                source,
                cover_url: row.get(6)?,
                media_mid: row.get(7)?,
            })
        }).map_err(|e| e.to_string())?;
        let tracks: Vec<Track> = rows.filter_map(|r| match r {
            Ok(t) => Some(t),
            Err(e) => { log::warn!("db: corrupt stale track row: {e}"); None }
        }).collect();
        Ok(tracks)
    }

    /// Get total number of play events (to check if enough data exists for recommendations).
    pub fn get_play_event_count(&self) -> Result<u64, String> {
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM play_events", [], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        Ok(count as u64)
    }

    /// Delete play events older than `days` days.
    pub fn purge_old_events(&self, days: u32) -> Result<(), String> {
        let now = now_epoch();
        let conn = self.pool.get_timeout(DB_CONNECTION_TIMEOUT)
            .map_err(|e| format!("database connection error: {e}"))?;
        let cutoff = now - (days as i64 * 86400);
        conn.execute("DELETE FROM play_events WHERE started_at <= ?1", rusqlite::params![cutoff])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
