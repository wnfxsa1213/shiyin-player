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
