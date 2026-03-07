use std::path::PathBuf;
use std::time::Duration;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rustplayer_core::{LyricsLine, MusicSourceId, Track};

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
                CREATE INDEX IF NOT EXISTS idx_lyrics_cached_at ON lyrics(cached_at);",
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
        let mut stmt = conn.prepare(
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
        let mut stmt = conn.prepare(
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
}

fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
