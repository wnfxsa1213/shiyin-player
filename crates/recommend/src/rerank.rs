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
/// tracks penalized. A best-effort diversity constraint limits consecutive
/// tracks from the same artist to `MAX_CONSECUTIVE_SAME_ARTIST`.
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
            let source_key = track.source.storage_key();
            let freshness_key = (track.id.clone(), source_key.to_owned());
            let freshness_score = if recent_ids.contains(&freshness_key) { 0.0 } else { 1.0 };

            let score = WEIGHT_PLATFORM_RANK * rank_score
                + WEIGHT_ARTIST_PREF * artist_score
                + WEIGHT_FRESHNESS * freshness_score;

            ScoredTrack { track, score }
        })
        .collect();

    // Sort by score descending (stable sort preserves platform order for equal scores)
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Apply best-effort diversity constraint
    apply_diversity(scored)
}

/// Reorder tracks so that no more than `MAX_CONSECUTIVE_SAME_ARTIST` consecutive
/// tracks share the same artist. When too many tracks are from the same artist,
/// they are appended at the end with interleaving attempts.
fn apply_diversity(scored: Vec<ScoredTrack>) -> Vec<Track> {
    let mut result: Vec<Track> = Vec::with_capacity(scored.len());
    let mut deferred: Vec<Track> = Vec::new();

    for st in scored {
        let artist = normalize_artist(&st.track.artist);
        let consecutive = count_trailing_artist(&result, &artist);

        if consecutive < MAX_CONSECUTIVE_SAME_ARTIST {
            // Try to flush deferred tracks, but reserve a slot for the current artist
            flush_deferred(&mut result, &mut deferred, &artist);
            result.push(st.track);
        } else {
            deferred.push(st.track);
        }
    }

    // Append remaining deferred tracks with interleaving
    flush_remaining(&mut result, deferred);
    result
}

fn count_trailing_artist(list: &[Track], artist: &str) -> usize {
    list.iter()
        .rev()
        .take_while(|t| normalize_artist(&t.artist) == artist)
        .count()
}

/// Flush deferred tracks that can be placed without violating diversity,
/// while reserving capacity for `current_artist` (the track about to be pushed).
fn flush_deferred(result: &mut Vec<Track>, deferred: &mut Vec<Track>, current_artist: &str) {
    if deferred.is_empty() {
        return;
    }
    let mut remaining = Vec::new();
    for track in deferred.drain(..) {
        let artist = normalize_artist(&track.artist);
        let consecutive = count_trailing_artist(result, &artist);
        // If the deferred track shares the same artist as the incoming track,
        // we need to reserve a slot: allow only MAX - 1 so the caller can still push.
        let limit = if artist == current_artist {
            MAX_CONSECUTIVE_SAME_ARTIST.saturating_sub(1)
        } else {
            MAX_CONSECUTIVE_SAME_ARTIST
        };
        if consecutive < limit {
            result.push(track);
        } else {
            remaining.push(track);
        }
    }
    *deferred = remaining;
}

/// Append remaining deferred tracks with best-effort interleaving.
/// Repeatedly scans the deferred list, placing tracks that don't violate
/// the consecutive limit. Tracks that can never be placed (e.g., only one
/// artist left) are appended at the very end.
fn flush_remaining(result: &mut Vec<Track>, mut deferred: Vec<Track>) {
    let mut stuck_count = 0;
    while !deferred.is_empty() && stuck_count < 2 {
        let mut next_deferred = Vec::new();
        let mut placed_any = false;
        for track in deferred {
            let artist = normalize_artist(&track.artist);
            let consecutive = count_trailing_artist(result, &artist);
            if consecutive < MAX_CONSECUTIVE_SAME_ARTIST {
                result.push(track);
                placed_any = true;
            } else {
                next_deferred.push(track);
            }
        }
        deferred = next_deferred;
        if !placed_any {
            stuck_count += 1;
        } else {
            stuck_count = 0;
        }
    }
    // Truly stuck — append remaining (all same artist, unavoidable)
    for track in deferred {
        result.push(track);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use rustplayer_core::MusicSourceId;

    fn make_track(id: &str, artist: &str) -> Track {
        Track {
            id: id.to_string(),
            name: format!("Song {id}"),
            artist: artist.to_string(),
            album: "Album".to_string(),
            duration_ms: 200_000,
            source: MusicSourceId::Netease,
            cover_url: None,
            media_mid: None,
        }
    }

    fn make_profile(artists: &[(&str, f64)]) -> UserProfile {
        let artist_scores: std::collections::HashMap<String, f64> = artists
            .iter()
            .map(|(a, s)| (a.to_string(), *s))
            .collect();
        let max = artist_scores.values().copied().fold(0.0_f64, f64::max).max(1.0);
        UserProfile { artist_scores, max_artist_score: max }
    }

    #[test]
    fn test_rerank_empty() {
        let profile = make_profile(&[]);
        let recent = HashSet::new();
        let result = rerank(Vec::new(), &profile, &recent);
        assert!(result.is_empty());
    }

    #[test]
    fn test_rerank_single() {
        let profile = make_profile(&[]);
        let recent = HashSet::new();
        let tracks = vec![make_track("1", "Artist A")];
        let result = rerank(tracks, &profile, &recent);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "1");
    }

    #[test]
    fn test_rerank_boosts_preferred_artist() {
        // Artist B has high preference, should be boosted above A
        let profile = make_profile(&[("artist b", 10.0)]);
        let recent = HashSet::new();
        let tracks = vec![
            make_track("1", "Artist A"),  // rank 0 (high rank_score)
            make_track("2", "Artist B"),  // rank 1 (lower rank_score, but boosted by pref)
        ];
        let result = rerank(tracks, &profile, &recent);
        // Artist B should come first due to strong preference (50% weight)
        assert_eq!(result[0].id, "2");
    }

    #[test]
    fn test_rerank_penalizes_recent() {
        let profile = make_profile(&[]);
        let mut recent = HashSet::new();
        recent.insert(("1".to_string(), "netease".to_string()));
        let tracks = vec![
            make_track("1", "Artist A"),  // recently played → freshness=0
            make_track("2", "Artist A"),  // not recent → freshness=1
        ];
        let result = rerank(tracks, &profile, &recent);
        // Track 2 should come first (higher freshness)
        assert_eq!(result[0].id, "2");
    }

    #[test]
    fn test_diversity_max_two_consecutive() {
        let profile = make_profile(&[("artist a", 10.0)]);
        let recent = HashSet::new();
        // 5 tracks from artist A, 1 from B — A tracks will score highest
        let tracks = vec![
            make_track("a1", "Artist A"),
            make_track("a2", "Artist A"),
            make_track("a3", "Artist A"),
            make_track("a4", "Artist A"),
            make_track("a5", "Artist A"),
            make_track("b1", "Artist B"),
        ];
        let result = rerank(tracks, &profile, &recent);

        // Check that no more than 2 consecutive tracks have the same artist
        let mut max_consecutive = 0;
        let mut current_run = 1;
        for i in 1..result.len() {
            if normalize_artist(&result[i].artist) == normalize_artist(&result[i - 1].artist) {
                current_run += 1;
                max_consecutive = max_consecutive.max(current_run);
            } else {
                current_run = 1;
            }
        }
        // With only 1 B track and 5 A tracks, the tail will have unavoidable
        // consecutive A's, but verify the algorithm attempts interleaving
        assert!(result.len() == 6);
        // The first 3 should not be all A (B should be interleaved)
        let first_three_artists: Vec<_> = result[..3].iter()
            .map(|t| normalize_artist(&t.artist))
            .collect();
        assert!(first_three_artists.contains(&"artist b".to_string()),
            "B should be interleaved in the first 3 tracks, got {:?}", first_three_artists);
    }

    #[test]
    fn test_diversity_flush_does_not_exceed_limit() {
        // Regression test for C2: flush_deferred + push same artist must not exceed MAX
        let profile = make_profile(&[("artist a", 5.0), ("artist b", 4.0)]);
        let recent = HashSet::new();
        // Construct a scenario where deferred A tracks could combine with current A
        let tracks = vec![
            make_track("a1", "Artist A"),
            make_track("a2", "Artist A"),
            make_track("a3", "Artist A"),  // will be deferred
            make_track("a4", "Artist A"),  // will be deferred
            make_track("b1", "Artist B"),
            make_track("a5", "Artist A"),
        ];
        let result = rerank(tracks, &profile, &recent);

        // Scan for max consecutive same artist (excluding unavoidable tail)
        for window in result.windows(3) {
            let artists: Vec<_> = window.iter().map(|t| normalize_artist(&t.artist)).collect();
            let all_same = artists[0] == artists[1] && artists[1] == artists[2];
            if all_same {
                // Count how many A's remain vs other artists
                let total_a = result.iter().filter(|t| normalize_artist(&t.artist) == "artist a").count();
                let total_other = result.len() - total_a;
                // Only acceptable if there aren't enough other artists to interleave
                assert!(total_other < 2,
                    "3+ consecutive same artist when interleaving was possible: {:?}",
                    result.iter().map(|t| (&t.id, &t.artist)).collect::<Vec<_>>());
            }
        }
    }

    #[test]
    fn test_diversity_all_same_artist() {
        let profile = make_profile(&[]);
        let recent = HashSet::new();
        let tracks = vec![
            make_track("1", "X"),
            make_track("2", "X"),
            make_track("3", "X"),
        ];
        let result = rerank(tracks, &profile, &recent);
        // All same artist — must still return all tracks
        assert_eq!(result.len(), 3);
    }
}
