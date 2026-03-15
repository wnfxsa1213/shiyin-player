use std::collections::HashSet;
use rustplayer_core::Track;
use crate::normalize::normalize_artist;
use crate::profile::UserProfile;

/// Scoring weights for the hybrid re-ranking algorithm.
const WEIGHT_PLATFORM_RANK: f64 = 0.30;
const WEIGHT_ARTIST_PREF: f64 = 0.50;
const WEIGHT_FRESHNESS: f64 = 0.20;

/// Maximum consecutive tracks from the same artist allowed in the final list.
const MAX_CONSECUTIVE_SAME_ARTIST: usize = 2;

struct ScoredTrack {
    track: Track,
    score: f64,
}

/// Re-rank platform recommendation tracks using local user preferences.
///
/// # Arguments
/// * `tracks` - Platform-recommended tracks (from both sources, merged).
/// * `profile` - User preference profile built from play history.
/// * `recent_ids` - Set of (track_id, source_key) played in the last 24 hours.
///
/// # Returns
/// Re-ranked track list with preferred artists boosted and recently-played
/// tracks penalized. A diversity constraint ensures no more than 2 consecutive
/// tracks from the same artist.
pub fn rerank(
    tracks: Vec<Track>,
    profile: &UserProfile,
    recent_ids: &HashSet<(String, String)>,
) -> Vec<Track> {
    if tracks.is_empty() {
        return tracks;
    }

    let total = tracks.len() as f64;
    let mut scored: Vec<ScoredTrack> = tracks
        .into_iter()
        .enumerate()
        .map(|(i, track)| {
            // 1. Platform rank score: first item gets 1.0, last gets ~0.0
            let rank_score = (total - i as f64) / total;

            // 2. Artist preference score: 0.0 if unknown, up to 1.0 for top artist
            let normalized_name = normalize_artist(&track.artist);
            let artist_score = profile
                .artist_scores
                .get(&normalized_name)
                .copied()
                .unwrap_or(0.0)
                / profile.max_artist_score;

            // 3. Freshness score: 1.0 if not recently played, 0.0 if played in last 24h
            // m1: use &str reference for source_key to avoid allocation
            let source_key = track.source.storage_key();
            let lookup = (track.id.as_str(), source_key);
            let is_recent = recent_ids.iter().any(|(id, src)| id == lookup.0 && src == lookup.1);
            let freshness_score = if is_recent { 0.0 } else { 1.0 };

            let score = WEIGHT_PLATFORM_RANK * rank_score
                + WEIGHT_ARTIST_PREF * artist_score
                + WEIGHT_FRESHNESS * freshness_score;

            ScoredTrack { track, score }
        })
        .collect();

    // Sort by score descending (stable sort preserves platform order for equal scores)
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Apply best-effort diversity constraint: tries to avoid more than
    // MAX_CONSECUTIVE_SAME_ARTIST in a row, but may not guarantee it
    // when too many tracks are from the same artist.
    apply_diversity(scored)
}

/// Reorder tracks so that no more than `MAX_CONSECUTIVE_SAME_ARTIST` consecutive
/// tracks share the same artist. Displaced tracks are inserted at the next
/// available position.
fn apply_diversity(scored: Vec<ScoredTrack>) -> Vec<Track> {
    let mut result: Vec<Track> = Vec::with_capacity(scored.len());
    let mut deferred: Vec<Track> = Vec::new();

    for st in scored {
        let artist = normalize_artist(&st.track.artist);
        let consecutive = count_trailing_artist(&result, &artist);

        if consecutive < MAX_CONSECUTIVE_SAME_ARTIST {
            // Flush any deferred tracks first (they have different artists)
            flush_deferred(&mut result, &mut deferred);
            result.push(st.track);
        } else {
            deferred.push(st.track);
        }
    }

    // Append any remaining deferred tracks
    result.extend(deferred);
    result
}

fn count_trailing_artist(list: &[Track], artist: &str) -> usize {
    list.iter()
        .rev()
        .take_while(|t| normalize_artist(&t.artist) == artist)
        .count()
}

fn flush_deferred(result: &mut Vec<Track>, deferred: &mut Vec<Track>) {
    if deferred.is_empty() {
        return;
    }
    // Insert deferred tracks that can now be placed without violating diversity
    let mut remaining = Vec::new();
    for track in deferred.drain(..) {
        let artist = normalize_artist(&track.artist);
        let consecutive = count_trailing_artist(result, &artist);
        if consecutive < MAX_CONSECUTIVE_SAME_ARTIST {
            result.push(track);
        } else {
            remaining.push(track);
        }
    }
    *deferred = remaining;
}
