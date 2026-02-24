use std::num::NonZeroUsize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use lru::LruCache;
use rustplayer_core::{MusicSourceId, Track};

const DEFAULT_TTL: Duration = Duration::from_secs(300); // 5 minutes
const DEFAULT_CAP: usize = 128;

struct CacheEntry<V> {
    value: V,
    expires_at: Instant,
}

pub struct SearchCache {
    inner: Mutex<LruCache<(MusicSourceId, String), CacheEntry<Vec<Track>>>>,
    ttl: Duration,
}

impl SearchCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LruCache::new(NonZeroUsize::new(DEFAULT_CAP).unwrap())),
            ttl: DEFAULT_TTL,
        }
    }

    pub fn get(&self, source: MusicSourceId, keyword: &str) -> Option<Vec<Track>> {
        let mut cache = self.inner.lock().ok()?;
        let key = (source, keyword.to_string());
        if let Some(entry) = cache.get(&key) {
            if Instant::now() < entry.expires_at {
                return Some(entry.value.clone());
            }
            cache.pop(&key);
        }
        None
    }

    pub fn set(&self, source: MusicSourceId, keyword: String, tracks: Vec<Track>) {
        if let Ok(mut cache) = self.inner.lock() {
            cache.put(
                (source, keyword),
                CacheEntry { value: tracks, expires_at: Instant::now() + self.ttl },
            );
        }
    }
}
