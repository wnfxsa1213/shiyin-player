use std::collections::HashMap;
use rustplayer_core::ArtistPreference;
use crate::normalize::normalize_artist;

/// Aggregated user preference profile built from play history.
pub struct UserProfile {
    /// Normalized artist name -> preference score (higher = stronger preference).
    pub artist_scores: HashMap<String, f64>,
    /// Maximum artist score, used for normalization in re-ranking.
    pub max_artist_score: f64,
}

/// Build a user profile from pre-aggregated artist statistics.
///
/// The `artist_stats` slice comes from the database, where play events
/// have already been aggregated per artist. This function normalizes
/// artist names (for cross-source matching) and merges scores.
pub fn build_profile(artist_stats: &[ArtistPreference]) -> UserProfile {
    let mut artist_scores: HashMap<String, f64> = HashMap::new();

    for stat in artist_stats {
        let key = normalize_artist(&stat.artist);
        if key.is_empty() {
            continue;
        }
        let entry = artist_scores.entry(key).or_insert(0.0);
        *entry += stat.score;
    }

    let max_artist_score = artist_scores
        .values()
        .copied()
        .fold(0.0_f64, f64::max)
        .max(1.0); // avoid division by zero

    UserProfile {
        artist_scores,
        max_artist_score,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_pref(artist: &str, score: f64) -> ArtistPreference {
        ArtistPreference {
            artist: artist.to_string(),
            play_count: 1,
            avg_completion_rate: 1.0,
            last_played_at: 0,
            score,
        }
    }

    #[test]
    fn test_build_profile_empty() {
        let profile = build_profile(&[]);
        assert!(profile.artist_scores.is_empty());
        assert!((profile.max_artist_score - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_build_profile_single() {
        let stats = vec![make_pref("Jay Chou", 5.0)];
        let profile = build_profile(&stats);
        assert_eq!(profile.artist_scores.len(), 1);
        assert!((profile.artist_scores["jay chou"] - 5.0).abs() < f64::EPSILON);
        assert!((profile.max_artist_score - 5.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_build_profile_merges_normalized() {
        let stats = vec![
            make_pref("Jay Chou", 3.0),
            make_pref("jay chou", 2.0),
            make_pref("JAY CHOU", 1.0),
        ];
        let profile = build_profile(&stats);
        assert_eq!(profile.artist_scores.len(), 1);
        assert!((profile.artist_scores["jay chou"] - 6.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_build_profile_skips_empty() {
        let stats = vec![
            make_pref("", 5.0),
            make_pref("  ", 3.0),
            make_pref("Valid", 2.0),
        ];
        let profile = build_profile(&stats);
        assert_eq!(profile.artist_scores.len(), 1);
        assert!(profile.artist_scores.contains_key("valid"));
    }

    #[test]
    fn test_build_profile_max_score_floor() {
        // Scores below 1.0 should still give max_artist_score of 1.0
        let stats = vec![make_pref("A", 0.5)];
        let profile = build_profile(&stats);
        assert!((profile.max_artist_score - 1.0).abs() < f64::EPSILON);
    }
}
