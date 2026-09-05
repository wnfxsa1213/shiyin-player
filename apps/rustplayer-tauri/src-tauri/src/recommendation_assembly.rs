use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::FutureExt;

use rustplayer_core::{
    ArtistPreference, DiscoveryOutcome, DiscoveryStatus, MusicSourceId, RecommendResult,
    RadioBatchResult, SourceError, Track,
};
use rustplayer_recommend::{
    build_profile, pick_rediscover, rerank_candidates, suggest_artists, RecommendationCandidate,
};
use rustplayer_sources::SourceRegistry;

use crate::db::Db;

const DAILY_RECOMMEND_TIMEOUT: Duration = Duration::from_secs(15);
const PERSONAL_FM_TIMEOUT: Duration = Duration::from_secs(10);
const PERSONALIZATION_EVENT_THRESHOLD: u64 = 10;
const ARTIST_PREFERENCE_DAYS: u32 = 90;
const ARTIST_PREFERENCE_LIMIT: u32 = 50;
const RECENT_TRACK_HOURS: u32 = 24;
const REDISCOVER_STALE_DAYS: u32 = 30;
const REDISCOVER_LIMIT: usize = 8;
const TOP_ARTISTS_LIMIT: usize = 10;
const RADIO_CANDIDATE_LIMIT: usize = 200;
const RADIO_RESULT_LIMIT: usize = 10;
const MAX_EXCLUDE_KEYS: usize = 2_000;

static MIX_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Builds the two music-discovery results behind one focused interface.
///
/// Source adapters supply their own daily recommendation or personal-FM feeds. This module
/// owns the shared behavior snapshot, candidate preparation, random cross-source mixing,
/// re-ranking, and discovery outcome. Commands remain transport entry points.
pub struct RecommendationAssembly {
    registry: Arc<SourceRegistry>,
    db: Arc<Db>,
}

impl RecommendationAssembly {
    pub fn new(registry: Arc<SourceRegistry>, db: Arc<Db>) -> Self {
        Self { registry, db }
    }

    pub async fn smart_recommend(&self) -> Result<RecommendResult, String> {
        let sources = self.collect_feed(DiscoveryFeed::DailyRecommend).await;
        let mut candidate_groups = candidate_groups_from_tracks(&sources.track_groups);
        deduplicate_groups(&mut candidate_groups);
        let candidates = mix_candidate_groups(candidate_groups, next_mix_seed());
        let discovery = discovery_status(&candidates, &sources);

        if discovery.outcome == DiscoveryOutcome::Unavailable {
            return Ok(RecommendResult {
                personalized: Vec::new(),
                top_artists: Vec::new(),
                rediscover: Vec::new(),
                discovery,
            });
        }

        let behavior = self.read_behavior_snapshot(true).await?;
        let personalized = rank_candidates(candidates, &behavior);
        let top_artists = suggest_artists(&behavior.artist_stats, TOP_ARTISTS_LIMIT);
        let rediscover = pick_rediscover(behavior.stale_tracks, REDISCOVER_LIMIT);

        self.purge_old_events();

        Ok(RecommendResult {
            personalized,
            top_artists,
            rediscover,
            discovery,
        })
    }

    pub async fn radio_batch(&self, exclude_keys: Vec<String>) -> Result<RadioBatchResult, String> {
        let sources = self.collect_feed(DiscoveryFeed::PersonalFm).await;
        let exclude_keys: HashSet<String> = exclude_keys.into_iter().take(MAX_EXCLUDE_KEYS).collect();
        let mut candidate_groups = candidate_groups_from_tracks(&sources.track_groups);
        for candidates in &mut candidate_groups {
            candidates.retain(|candidate| {
                let key = format!("{}:{}", candidate.track.source.storage_key(), candidate.track.id);
                !exclude_keys.contains(&key)
            });
        }
        deduplicate_groups(&mut candidate_groups);
        let mut candidates = mix_candidate_groups(candidate_groups, next_mix_seed());
        candidates.truncate(RADIO_CANDIDATE_LIMIT);
        let discovery = discovery_status(&candidates, &sources);

        if discovery.outcome == DiscoveryOutcome::Unavailable {
            return Ok(RadioBatchResult {
                tracks: Vec::new(),
                discovery,
            });
        }

        let behavior = self.read_behavior_snapshot(false).await?;
        let tracks = rank_candidates(candidates, &behavior)
            .into_iter()
            .take(RADIO_RESULT_LIMIT)
            .collect();

        Ok(RadioBatchResult { tracks, discovery })
    }

    async fn collect_feed(&self, feed: DiscoveryFeed) -> SourceCollection {
        let logged_in_sources: Vec<_> = self.registry.all()
            .iter()
            .filter(|source| source.is_logged_in())
            .cloned()
            .collect();
        let mut join_set = tokio::task::JoinSet::new();

        for (index, source) in logged_in_sources.into_iter().enumerate() {
            join_set.spawn(async move {
                let id = source.id();
                let timeout = match feed {
                    DiscoveryFeed::DailyRecommend => DAILY_RECOMMEND_TIMEOUT,
                    DiscoveryFeed::PersonalFm => PERSONAL_FM_TIMEOUT,
                };
                let result = std::panic::AssertUnwindSafe(async {
                    match tokio::time::timeout(timeout, async {
                        match feed {
                            DiscoveryFeed::DailyRecommend => source.get_daily_recommend().await,
                            DiscoveryFeed::PersonalFm => source.get_personal_fm().await,
                        }
                    }).await {
                        Ok(result) => result,
                        Err(_) => Err(SourceError::Network(format!("{} recommendation timed out", id.display_name()))),
                    }
                }).catch_unwind().await.unwrap_or_else(|_| {
                    Err(SourceError::Internal("music discovery source panicked".into()))
                });
                (index, id, result)
            });
        }

        let mut responses = Vec::new();
        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok(response) => responses.push(response),
                Err(error) => tracing::warn!(error = ?error, "music discovery task failed before reporting its source"),
            }
        }
        responses.sort_by_key(|(index, _, _)| *index);

        let mut source_collection = SourceCollection::default();
        for (_, id, result) in responses {
            match result {
                Ok(tracks) => {
                    source_collection.responded_sources.push(id);
                    source_collection.track_groups.push(tracks);
                }
                Err(error) => {
                    tracing::warn!(source = ?id, error = ?error, "music discovery source failed");
                    source_collection.unavailable_sources.push(id);
                }
            }
        }
        source_collection
    }

    async fn read_behavior_snapshot(&self, include_rediscover: bool) -> Result<BehaviorSnapshot, String> {
        let db = Arc::clone(&self.db);
        tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
            let artist_stats = db.get_artist_stats(ARTIST_PREFERENCE_DAYS, ARTIST_PREFERENCE_LIMIT)?;
            let recent_ids = db.get_recent_track_ids(RECENT_TRACK_HOURS)?;
            let event_count = db.get_play_event_count()?;
            let stale_tracks = if include_rediscover {
                db.get_stale_tracks(REDISCOVER_STALE_DAYS, REDISCOVER_LIMIT as u32)?
            } else {
                Vec::new()
            };
            Ok(BehaviorSnapshot {
                artist_stats,
                recent_ids,
                event_count,
                stale_tracks,
            })
        })
        .await
        .map_err(|error| error.to_string())?
    }

    fn purge_old_events(&self) {
        let db = Arc::clone(&self.db);
        tokio::spawn(async move {
            let _ = tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = db.purge_old_events(180) {
                    tracing::warn!(%error, "purge old music discovery events failed");
                }
            }).await;
        });
    }
}

#[derive(Clone, Copy)]
enum DiscoveryFeed {
    DailyRecommend,
    PersonalFm,
}

#[derive(Default)]
struct SourceCollection {
    track_groups: Vec<Vec<Track>>,
    responded_sources: Vec<MusicSourceId>,
    unavailable_sources: Vec<MusicSourceId>,
}

struct BehaviorSnapshot {
    artist_stats: Vec<ArtistPreference>,
    recent_ids: HashSet<(String, String)>,
    event_count: u64,
    stale_tracks: Vec<Track>,
}

fn candidate_groups_from_tracks(track_groups: &[Vec<Track>]) -> Vec<Vec<RecommendationCandidate>> {
    track_groups.iter().map(|tracks| {
        let total = tracks.len() as f64;
        tracks.iter().cloned().enumerate().map(|(index, track)| RecommendationCandidate {
            track,
            platform_rank: (total - index as f64) / total,
        }).collect()
    }).collect()
}

fn deduplicate_groups(candidate_groups: &mut [Vec<RecommendationCandidate>]) {
    let mut seen = HashSet::new();
    for candidates in candidate_groups {
        candidates.retain(|candidate| {
            seen.insert((candidate.track.id.clone(), candidate.track.source))
        });
    }
}

fn rank_candidates(candidates: Vec<RecommendationCandidate>, behavior: &BehaviorSnapshot) -> Vec<Track> {
    if behavior.event_count < PERSONALIZATION_EVENT_THRESHOLD {
        return candidates.into_iter().map(|candidate| candidate.track).collect();
    }
    let profile = build_profile(&behavior.artist_stats);
    rerank_candidates(candidates, &profile, &behavior.recent_ids)
}

fn discovery_status(candidates: &[RecommendationCandidate], sources: &SourceCollection) -> DiscoveryStatus {
    let available_sources = sources.responded_sources.iter()
        .copied()
        .filter(|source| candidates.iter().any(|candidate| candidate.track.source == *source))
        .collect();
    let outcome = if candidates.is_empty() {
        if sources.responded_sources.is_empty() {
            DiscoveryOutcome::Unavailable
        } else {
            DiscoveryOutcome::Empty
        }
    } else if sources.unavailable_sources.is_empty() {
        DiscoveryOutcome::Complete
    } else {
        DiscoveryOutcome::Degraded
    };

    DiscoveryStatus {
        outcome,
        available_sources,
        unavailable_sources: sources.unavailable_sources.clone(),
    }
}

fn mix_candidate_groups(
    candidate_groups: Vec<Vec<RecommendationCandidate>>,
    mut seed: u64,
) -> Vec<RecommendationCandidate> {
    let mut offsets = vec![0; candidate_groups.len()];
    let mut mixed = Vec::new();

    while candidate_groups.iter().zip(&offsets).any(|(group, offset)| *offset < group.len()) {
        let available_groups: Vec<_> = candidate_groups.iter().zip(&offsets)
            .enumerate()
            .filter_map(|(index, (group, offset))| (*offset < group.len()).then_some(index))
            .collect();
        seed = xorshift64(seed);
        let group_index = available_groups[(seed as usize) % available_groups.len()];
        mixed.push(candidate_groups[group_index][offsets[group_index]].clone());
        offsets[group_index] += 1;
    }
    mixed
}

fn next_mix_seed() -> u64 {
    let time_seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    time_seed ^ MIX_SEQUENCE.fetch_add(1, Ordering::Relaxed).wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

fn xorshift64(mut value: u64) -> u64 {
    if value == 0 {
        value = 0xA076_1D64_78BD_642F;
    }
    value ^= value << 13;
    value ^= value >> 7;
    value ^ (value << 17)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str, source: MusicSourceId) -> Track {
        Track {
            id: id.into(),
            name: id.into(),
            artist: "artist".into(),
            album: "album".into(),
            duration_ms: 1,
            source,
            cover_url: None,
            media_mid: None,
        }
    }

    #[derive(Clone)]
    struct FakeSource {
        id: MusicSourceId,
        daily: Result<Vec<Track>, SourceError>,
        fm: Result<Vec<Track>, SourceError>,
    }

    #[async_trait::async_trait]
    impl rustplayer_core::MusicSource for FakeSource {
        fn id(&self) -> MusicSourceId { self.id }
        fn name(&self) -> &'static str { "fake" }
        async fn search(&self, _: rustplayer_core::SearchQuery) -> Result<Vec<Track>, SourceError> { Ok(Vec::new()) }
        async fn get_stream_url(&self, _: &Track) -> Result<rustplayer_core::StreamInfo, SourceError> {
            Err(SourceError::Unimplemented)
        }
        async fn get_lyrics(&self, _: &str) -> Result<Vec<rustplayer_core::LyricsLine>, SourceError> { Ok(Vec::new()) }
        async fn get_album_art(&self, _: &str) -> Result<Option<String>, SourceError> { Ok(None) }
        async fn login(&self, _: rustplayer_core::Credentials) -> Result<rustplayer_core::AuthToken, SourceError> {
            Err(SourceError::Unimplemented)
        }
        async fn get_daily_recommend(&self) -> Result<Vec<Track>, SourceError> { self.daily.clone() }
        async fn get_personal_fm(&self) -> Result<Vec<Track>, SourceError> { self.fm.clone() }
        fn is_logged_in(&self) -> bool { true }
    }

    fn test_assembly(sources: Vec<FakeSource>) -> RecommendationAssembly {
        static TEST_DB_SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let mut registry = SourceRegistry::new();
        for source in sources {
            registry.register(Arc::new(source));
        }
        let path = std::env::temp_dir().join(format!(
            "shiyin-recommendation-assembly-{}-{}",
            std::process::id(),
            TEST_DB_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        ));
        let db = Arc::new(Db::open(path).expect("test database opens"));
        RecommendationAssembly::new(Arc::new(registry), db)
    }

    fn source(
        id: MusicSourceId,
        daily: Result<Vec<Track>, SourceError>,
        fm: Result<Vec<Track>, SourceError>,
    ) -> FakeSource {
        FakeSource { id, daily, fm }
    }

    #[test]
    fn random_interleave_preserves_source_order_and_platform_rank() {
        let candidate_groups = candidate_groups_from_tracks(&[
            vec![track("n1", MusicSourceId::Netease), track("n2", MusicSourceId::Netease)],
            vec![track("q1", MusicSourceId::Qqmusic), track("q2", MusicSourceId::Qqmusic)],
        ]);
        let ranks: std::collections::HashMap<_, _> = candidate_groups.iter().flatten()
            .map(|candidate| (candidate.track.id.clone(), candidate.platform_rank))
            .collect();

        let candidates = mix_candidate_groups(candidate_groups, 2);
        let ids = candidates.iter().map(|candidate| candidate.track.id.as_str()).collect::<Vec<_>>();

        assert_eq!(ids, vec!["n1", "q1", "n2", "q2"]);
        for candidate in candidates {
            assert_eq!(ranks[&candidate.track.id], candidate.platform_rank);
        }
    }

    #[test]
    fn deduplication_keeps_same_id_from_different_sources() {
        let mut candidate_groups = candidate_groups_from_tracks(&[
            vec![track("same", MusicSourceId::Netease), track("same", MusicSourceId::Netease)],
            vec![track("same", MusicSourceId::Qqmusic)],
        ]);

        deduplicate_groups(&mut candidate_groups);

        assert_eq!(candidate_groups.iter().flatten().count(), 2);
    }

    #[test]
    fn discovery_is_unavailable_only_without_any_source_response() {
        let unavailable = discovery_status(&[], &SourceCollection::default());
        assert_eq!(unavailable.outcome, DiscoveryOutcome::Unavailable);

        let empty = discovery_status(&[], &SourceCollection {
            responded_sources: vec![MusicSourceId::Netease],
            ..Default::default()
        });
        assert_eq!(empty.outcome, DiscoveryOutcome::Empty);
    }

    #[test]
    fn discovery_marks_partial_candidates_as_degraded() {
        let candidates = mix_candidate_groups(candidate_groups_from_tracks(&[vec![track("n1", MusicSourceId::Netease)]]), 1);
        let discovery = discovery_status(&candidates, &SourceCollection {
            responded_sources: vec![MusicSourceId::Netease],
            unavailable_sources: vec![MusicSourceId::Qqmusic],
            ..Default::default()
        });
        assert_eq!(discovery.outcome, DiscoveryOutcome::Degraded);
    }

    #[test]
    fn discovery_lists_only_sources_that_contributed_candidates() {
        let candidates = mix_candidate_groups(candidate_groups_from_tracks(&[vec![track("q1", MusicSourceId::Qqmusic)]]), 1);
        let discovery = discovery_status(&candidates, &SourceCollection {
            responded_sources: vec![MusicSourceId::Netease, MusicSourceId::Qqmusic],
            ..Default::default()
        });

        assert_eq!(discovery.outcome, DiscoveryOutcome::Complete);
        assert_eq!(discovery.available_sources, vec![MusicSourceId::Qqmusic]);
    }
    #[tokio::test]
    async fn smart_recommendation_reports_complete_and_degraded_results() {
        let complete = test_assembly(vec![
            source(MusicSourceId::Netease, Ok(vec![track("n1", MusicSourceId::Netease)]), Ok(Vec::new())),
            source(MusicSourceId::Qqmusic, Ok(vec![track("q1", MusicSourceId::Qqmusic)]), Ok(Vec::new())),
        ]).smart_recommend().await.expect("complete discovery returns a result");
        assert_eq!(complete.discovery.outcome, DiscoveryOutcome::Complete);
        assert_eq!(complete.personalized.len(), 2);

        let degraded = test_assembly(vec![
            source(MusicSourceId::Netease, Ok(vec![track("n1", MusicSourceId::Netease)]), Ok(Vec::new())),
            source(MusicSourceId::Qqmusic, Err(SourceError::Network("offline".into())), Ok(Vec::new())),
        ]).smart_recommend().await.expect("degraded discovery preserves candidates");
        assert_eq!(degraded.discovery.outcome, DiscoveryOutcome::Degraded);
        assert_eq!(degraded.discovery.available_sources, vec![MusicSourceId::Netease]);
        assert_eq!(degraded.discovery.unavailable_sources, vec![MusicSourceId::Qqmusic]);
        assert_eq!(degraded.personalized.len(), 1);
    }

    #[tokio::test]
    async fn smart_recommendation_distinguishes_empty_from_unavailable() {
        let empty = test_assembly(vec![
            source(MusicSourceId::Netease, Ok(Vec::new()), Ok(Vec::new())),
        ]).smart_recommend().await.expect("empty source result is a discovery result");
        assert_eq!(empty.discovery.outcome, DiscoveryOutcome::Empty);

        let unavailable = test_assembly(vec![
            source(MusicSourceId::Netease, Err(SourceError::Network("offline".into())), Ok(Vec::new())),
        ]).smart_recommend().await.expect("unavailable source result is explainable");
        assert_eq!(unavailable.discovery.outcome, DiscoveryOutcome::Unavailable);
    }

    #[tokio::test]
    async fn radio_batch_returns_empty_after_queue_exclusion_without_playlist_fallback() {
        let result = test_assembly(vec![
            source(
                MusicSourceId::Netease,
                Ok(Vec::new()),
                Ok(vec![track("n1", MusicSourceId::Netease)]),
            ),
        ]).radio_batch(vec!["netease:n1".into()]).await.expect("radio result returns normally");

        assert_eq!(result.discovery.outcome, DiscoveryOutcome::Empty);
        assert!(result.tracks.is_empty());
    }

}
