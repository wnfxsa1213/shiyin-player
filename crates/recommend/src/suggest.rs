use rustplayer_core::{ArtistPreference, Track};

/// Return the top `limit` artists by preference score.
///
/// The input `artist_stats` should already be sorted by score from the database.
/// This function simply truncates to the requested limit.
pub fn suggest_artists(artist_stats: &[ArtistPreference], limit: usize) -> Vec<ArtistPreference> {
    artist_stats.iter().take(limit).cloned().collect()
}

/// Pick tracks for the "rediscover" section from stale (not recently played) tracks.
///
/// Selects up to `limit` tracks, preferring tracks with higher historical
/// play frequency (indicated by appearing earlier in the `stale_tracks` list,
/// which should be pre-sorted by play_count DESC from the database).
pub fn pick_rediscover(stale_tracks: Vec<Track>, limit: usize) -> Vec<Track> {
    stale_tracks.into_iter().take(limit).collect()
}
