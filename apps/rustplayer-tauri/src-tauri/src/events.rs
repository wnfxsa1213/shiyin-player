use std::sync::Arc;
use rustplayer_core::{PlayerEvent, PlayerState};
use rustplayer_player::Player;
use tauri::{AppHandle, Emitter};

pub fn spawn_event_forwarder(app: AppHandle, player: &Arc<Player>) {
    let mut rx = player.subscribe();

    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let (channel, payload) = match &event {
                        PlayerEvent::StateChanged { state } => {
                            ("player://state", serde_json::Value::String(state_label(state).into()))
                        }
                        PlayerEvent::Progress { position_ms, duration_ms } => {
                            ("player://progress", serde_json::json!({
                                "positionMs": position_ms,
                                "durationMs": duration_ms,
                            }))
                        }
                        PlayerEvent::Spectrum { magnitudes } => {
                            ("player://spectrum", serde_json::json!({
                                "magnitudes": magnitudes,
                            }))
                        }
                        PlayerEvent::Error { error } => {
                            ("player://error", serde_json::Value::String(error.to_string()))
                        }
                    };
                    if let Err(e) = app.emit(channel, payload) {
                        log::warn!("failed to emit {channel}: {e}");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("event forwarder lagged, skipped {n} events");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
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
        PlayerState::Stopped => "stopped",
    }
}
