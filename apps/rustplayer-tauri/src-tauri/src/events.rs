use std::sync::Arc;
use std::time::Instant;
use rustplayer_core::{PlayerEvent, PlayerState};
use rustplayer_player::Player;
use tauri::{AppHandle, Emitter};

pub fn spawn_event_forwarder(app: AppHandle, player: &Arc<Player>) {
    let mut rx = player.subscribe();

    tauri::async_runtime::spawn(async move {
        let mut last_spectrum_emit: Option<Instant> = None;
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let (channel, payload) = match &event {
                        PlayerEvent::StateChanged { state } => {
                            ("player://state", serde_json::Value::String(state_label(state).into()))
                        }
                        PlayerEvent::Progress { position_ms, duration_ms } => {
                            let emitted_at_ms = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;
                            ("player://progress", serde_json::json!({
                                "positionMs": position_ms,
                                "durationMs": duration_ms,
                                "emittedAtMs": emitted_at_ms,
                            }))
                        }
                        PlayerEvent::Spectrum { magnitudes } => {
                            let now = Instant::now();
                            if let Some(last) = last_spectrum_emit {
                                if now.duration_since(last) < std::time::Duration::from_millis(66) {
                                    continue; // throttle to ~15fps
                                }
                            }
                            last_spectrum_emit = Some(now);
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
