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
            // Merge into existing entry
            existing.play_count += stat.play_count;
            existing.score += stat.score;
            if stat.last_played_at > existing.last_played_at {
                existing.last_played_at = stat.last_played_at;
            }
        } else if seen.insert(key) {
            result.push(stat.clone());
        }
        if result.len() >= limit {
            break;
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
