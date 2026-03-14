use std::sync::Arc;
use serde::Serialize;
use rustplayer_core::{PlayerEvent, PlayerState};
use rustplayer_player::Player;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    position_ms: u64,
    duration_ms: u64,
    emitted_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpectrumPayload {
    magnitudes: Arc<[f32]>,
}

pub fn spawn_event_forwarder(app: AppHandle, player: &Arc<Player>) {
    let mut rx = player.subscribe();

    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    // Avoid constructing serde_json::Value on the hot path.
                    // Let Tauri serialize typed payloads directly (fewer allocations).
                    let (channel, emit_result) = match event {
                        PlayerEvent::StateChanged { state } => {
                            ("player://state", app.emit("player://state", state_label(&state)))
                        }
                        PlayerEvent::Progress { position_ms, duration_ms } => {
                            let emitted_at_ms = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;
                            ("player://progress", app.emit("player://progress", ProgressPayload {
                                position_ms,
                                duration_ms,
                                emitted_at_ms,
                            }))
                        }
                        // Spectrum events are forwarded directly — GStreamer spectrum interval
                        // is already set to ~15fps in the pipeline, no need for secondary throttling.
                        PlayerEvent::Spectrum { magnitudes } => {
                            ("player://spectrum", app.emit("player://spectrum", SpectrumPayload { magnitudes }))
                        }
                        PlayerEvent::Error { error } => {
                            ("player://error", app.emit("player://error", error.to_string()))
                        }
                    };
                    if let Err(e) = emit_result {
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
