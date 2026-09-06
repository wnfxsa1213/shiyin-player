use rustplayer_core::{PlaybackId, PlayerEvent, PlayerEventEnvelope, PlayerState};
use rustplayer_player::Player;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum PlaybackPayload {
    State {
        playback_id: PlaybackId,
        state: &'static str,
        position_ms: u64,
    },
    Progress {
        playback_id: PlaybackId,
        position_ms: u64,
        duration_ms: u64,
        emitted_at_ms: u64,
    },
    Buffering {
        playback_id: PlaybackId,
        percent: i32,
    },
    Error {
        playback_id: PlaybackId,
        message: String,
    },
    Ended {
        playback_id: PlaybackId,
    },
}

#[derive(Debug, Clone, Serialize)]
struct SpectrumPayload {
    magnitudes: Arc<[f32]>,
}

fn playback_payload(envelope: PlayerEventEnvelope) -> Option<PlaybackPayload> {
    let playback_id = envelope.playback_id;
    Some(match envelope.event {
        PlayerEvent::StateChanged { state } => {
            let position_ms = match &state {
                PlayerState::Playing { position_ms, .. }
                | PlayerState::Paused { position_ms, .. } => *position_ms,
                _ => 0,
            };
            PlaybackPayload::State {
                playback_id,
                state: state_label(&state),
                position_ms,
            }
        }
        PlayerEvent::Progress {
            position_ms,
            duration_ms,
        } => PlaybackPayload::Progress {
            playback_id,
            position_ms,
            duration_ms,
            emitted_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        },
        PlayerEvent::Error { error } => PlaybackPayload::Error {
            playback_id,
            message: error.to_string(),
        },
        PlayerEvent::Buffering { percent } => PlaybackPayload::Buffering {
            playback_id,
            percent,
        },
        PlayerEvent::Ended => PlaybackPayload::Ended { playback_id },
        PlayerEvent::Spectrum { .. } => return None,
    })
}

pub fn spawn_event_forwarder(app: AppHandle, player: &Arc<Player>) {
    let mut rx = player.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(envelope) => {
                    // Keep spectrum outside the lifecycle state and preserve its allocation profile.
                    let (channel, result) = match envelope.event {
                        PlayerEvent::Spectrum { magnitudes } => (
                            "player://spectrum",
                            app.emit("player://spectrum", SpectrumPayload { magnitudes }),
                        ),
                        _ => match playback_payload(envelope) {
                            Some(payload) => {
                                ("player://event", app.emit("player://event", payload))
                            }
                            None => continue,
                        },
                    };
                    if let Err(error) = result {
                        log::warn!("failed to emit {channel}: {error}");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("event forwarder lagged, skipped {n} events");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

fn state_label(state: &PlayerState) -> &'static str {
    match state {
        PlayerState::Idle => "idle",
        PlayerState::Loading { .. } => "loading",
        PlayerState::Playing { .. } => "playing",
        PlayerState::Paused { .. } => "paused",
        PlayerState::Buffering { .. } => "buffering",
        PlayerState::Stopped => "stopped",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_payload_preserves_id_and_distinguishes_end_from_stop() {
        let ended = playback_payload(PlayerEventEnvelope {
            playback_id: 42,
            event: PlayerEvent::Ended,
        })
        .unwrap();
        assert_eq!(
            serde_json::to_value(ended).unwrap(),
            serde_json::json!({"type": "ended", "playbackId": 42})
        );
        let stopped = playback_payload(PlayerEventEnvelope {
            playback_id: 42,
            event: PlayerEvent::StateChanged {
                state: PlayerState::Stopped,
            },
        })
        .unwrap();
        assert_eq!(
            serde_json::to_value(stopped).unwrap(),
            serde_json::json!({"type": "state", "playbackId": 42, "state": "stopped", "positionMs": 0})
        );
    }
}
