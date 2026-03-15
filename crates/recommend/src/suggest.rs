use std::collections::HashSet;
use rustplayer_core::{ArtistPreference, Track};
use crate::normalize::normalize_artist;

/// Return the top `limit` artists by preference score, deduplicated by normalized name.
///
/// Different spellings of the same artist (e.g. "Jay Chou" vs "jay chou") are merged:
/// the first occurrence's display name is kept, scores are summed.
pub fn suggest_artists(artist_stats: &[ArtistPreference], limit: usize) -> Vec<ArtistPreference> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<ArtistPreference> = Vec::new();

    for stat in artist_stats {
        let key = normalize_artist(&stat.artist);
        if key.is_empty() {
            continue;
        }
        if let Some(existing) = result.iter_mut().find(|r| normalize_artist(&r.artist) == key) {
            // Merge into existing entry (even if we already hit `limit`,
            // because this doesn't add a new artist — it refines an existing one)
            existing.play_count += stat.play_count;
            existing.score += stat.score;
            if stat.last_played_at > existing.last_played_at {
                existing.last_played_at = stat.last_played_at;
            }
        } else if result.len() < limit && seen.insert(key) {
            // Only add new artists while under the limit
            result.push(stat.clone());
        }
    }

    result
}

/// Pick tracks for the "rediscover" section from stale (not recently played) tracks.
///
/// Selects up to `limit` tracks, preferring tracks with higher historical
/// play frequency (indicated by appearing earlier in the `stale_tracks` list,
/// which should be pre-sorted by play_count DESC from the database).
pub fn pick_rediscover(stale_tracks: Vec<Track>, limit: usize) -> Vec<Track> {
    stale_tracks.into_iter().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rustplayer_core::MusicSourceId;

    fn make_pref(artist: &str, score: f64, play_count: u32, last_played: i64) -> ArtistPreference {
        ArtistPreference {
            artist: artist.to_string(),
            play_count,
            avg_completion_rate: 1.0,
            last_played_at: last_played,
            score,
        }
    }

    fn make_track(id: &str) -> Track {
        Track {
            id: id.to_string(),
            name: format!("Track {id}"),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            duration_ms: 180_000,
            source: MusicSourceId::Netease,
            cover_url: None,
            media_mid: None,
        }
    }

    #[test]
    fn test_suggest_artists_basic() {
        let stats = vec![
            make_pref("A", 10.0, 5, 100),
            make_pref("B", 8.0, 3, 90),
            make_pref("C", 6.0, 2, 80),
        ];
        let result = suggest_artists(&stats, 2);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].artist, "A");
        assert_eq!(result[1].artist, "B");
    }

    #[test]
    fn test_suggest_artists_merges_variants() {
        let stats = vec![
            make_pref("Jay Chou", 5.0, 3, 100),
            make_pref("jay chou", 3.0, 2, 200),
        ];
        let result = suggest_artists(&stats, 10);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].artist, "Jay Chou"); // keeps first display name
        assert_eq!(result[0].play_count, 5);
        assert!((result[0].score - 8.0).abs() < f64::EPSILON);
        assert_eq!(result[0].last_played_at, 200); // takes latest
    }

    #[test]
    fn test_suggest_artists_merges_after_limit() {
        // Regression test for m1: merging should continue even after limit is reached
        let stats = vec![
            make_pref("A", 5.0, 3, 100),
            make_pref("B", 4.0, 2, 90),
            // After limit=2, these should still merge into existing entries
            make_pref("a", 2.0, 1, 50),  // merges into "A"
        ];
        let result = suggest_artists(&stats, 2);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].play_count, 4); // 3 + 1
        assert!((result[0].score - 7.0).abs() < f64::EPSILON); // 5 + 2
    }

    #[test]
    fn test_suggest_artists_skips_empty() {
        let stats = vec![
            make_pref("", 10.0, 5, 100),
            make_pref("  ", 8.0, 3, 90),
            make_pref("Valid", 6.0, 2, 80),
        ];
        let result = suggest_artists(&stats, 10);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].artist, "Valid");
    }

    #[test]
    fn test_suggest_artists_empty_input() {
        let result = suggest_artists(&[], 5);
        assert!(result.is_empty());
    }

    #[test]
    fn test_pick_rediscover_basic() {
        let tracks = vec![make_track("1"), make_track("2"), make_track("3")];
        let result = pick_rediscover(tracks, 2);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "1");
        assert_eq!(result[1].id, "2");
    }

    #[test]
    fn test_pick_rediscover_empty() {
        let result = pick_rediscover(Vec::new(), 5);
        assert!(result.is_empty());
    }

    #[test]
    fn test_pick_rediscover_limit_exceeds() {
        let tracks = vec![make_track("1")];
        let result = pick_rediscover(tracks, 5);
        assert_eq!(result.len(), 1);
    }
}
