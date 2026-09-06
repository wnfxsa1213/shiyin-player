use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use gst::prelude::*;
use gstreamer as gst;
use rustplayer_core::{
    PlaybackId, PlayerCommand, PlayerError, PlayerEvent, PlayerEventEnvelope, PlayerState,
    StreamInfo, Track,
};
use tokio::sync::{broadcast, mpsc, oneshot};

struct EngineRequest {
    command: PlayerCommand,
    response: Option<oneshot::Sender<Result<(), PlayerError>>>,
}

pub struct Player {
    cmd_tx: Option<mpsc::Sender<EngineRequest>>,
    event_tx: broadcast::Sender<PlayerEventEnvelope>,
    latest_request: Arc<AtomicU64>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Player {
    pub fn new() -> Result<Self, PlayerError> {
        Self::with_audio_sink("autoaudiosink")
    }

    fn with_audio_sink(audio_sink: &'static str) -> Result<Self, PlayerError> {
        let (cmd_tx, cmd_rx) = mpsc::channel::<EngineRequest>(64);
        let (event_tx, _) = broadcast::channel::<PlayerEventEnvelope>(256);
        let tx = event_tx.clone();
        let latest_request = Arc::new(AtomicU64::new(0));
        let engine_request = Arc::clone(&latest_request);

        let handle = std::thread::Builder::new()
            .name("gstreamer-engine".into())
            .spawn(move || {
                if let Err(e) = engine_loop(cmd_rx, tx, engine_request, audio_sink) {
                    log::error!("player engine error: {e}");
                }
            })
            .map_err(|e| PlayerError::Internal(e.to_string()))?;

        Ok(Self {
            cmd_tx: Some(cmd_tx),
            event_tx,
            latest_request,
            thread: Some(handle),
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PlayerEventEnvelope> {
        self.event_tx.subscribe()
    }

    pub async fn send(&self, cmd: PlayerCommand) -> Result<(), PlayerError> {
        // A load is accepted when enqueued; its eventual outcome arrives as tagged events.
        // Keeping this await limited to enqueueing makes timeout cancellation safe.
        if matches!(&cmd, PlayerCommand::Load { .. }) {
            return self
                .cmd_tx
                .as_ref()
                .ok_or(PlayerError::ChannelClosed)?
                .send(EngineRequest {
                    command: cmd,
                    response: None,
                })
                .await
                .map_err(|_| PlayerError::ChannelClosed);
        }
        let (response, result) = oneshot::channel();
        self.cmd_tx
            .as_ref()
            .ok_or(PlayerError::ChannelClosed)?
            .send(EngineRequest {
                command: cmd,
                response: Some(response),
            })
            .await
            .map_err(|_| PlayerError::ChannelClosed)?;
        result.await.map_err(|_| PlayerError::ChannelClosed)?
    }

    /// Reserve before resolving a stream URL so a late older request cannot load audio.
    pub fn reserve_request(&self, playback_id: PlaybackId) -> bool {
        playback_id > self.latest_request.fetch_max(playback_id, Ordering::SeqCst)
    }

    pub fn is_current_request(&self, playback_id: PlaybackId) -> bool {
        playback_id == self.latest_request.load(Ordering::SeqCst)
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        // Drop cmd_tx to close the channel, signaling the engine thread to exit
        self.cmd_tx.take();
        if let Some(handle) = self.thread.take() {
            // Use a helper thread + channel to implement a timeout join,
            // avoiding indefinite blocking if GStreamer hangs.
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = handle.join();
                let _ = tx.send(());
            });
            if rx.recv_timeout(Duration::from_secs(3)).is_err() {
                log::warn!("player engine thread did not exit within 3s, abandoning join");
            }
        }
    }
}

// --- Engine internals ---

struct Engine {
    playback_id: PlaybackId,
    latest_request: Arc<AtomicU64>,
    volume: f32,
    desired_playing: bool,
    initializing: bool,
    initial_seek: Option<u64>,
    seeking: bool,
    buffering_percent: i32,
    audio_sink: &'static str,
    pipeline: Option<gst::Pipeline>,
    volume_elem: Option<gst::Element>,
    state: PlayerState,
    current_track: Option<Arc<Track>>,
    /// Timing for "Load command handled → pipeline enters Playing" measurement.
    loading_since: Option<std::time::Instant>,
    /// Time-based progress emission (replaces tick-count based approach).
    last_progress_emit: Option<std::time::Instant>,
    /// Time-based state mismatch detection (replaces tick-count based approach).
    state_mismatch_since: Option<std::time::Instant>,
    /// Pre-allocated spectrum buffer — avoids ~15 heap allocations per second.
    spectrum_buf: Vec<f32>,
    /// Tracks when buffering started for timeout protection.
    buffering_since: Option<std::time::Instant>,
}

fn engine_loop(
    mut cmd_rx: mpsc::Receiver<EngineRequest>,
    event_tx: broadcast::Sender<PlayerEventEnvelope>,
    latest_request: Arc<AtomicU64>,
    audio_sink: &'static str,
) -> Result<(), PlayerError> {
    gst::init().map_err(|e| PlayerError::Pipeline(e.to_string()))?;

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .map_err(|e| PlayerError::Internal(e.to_string()))?;

    rt.block_on(async {
        let mut engine = Engine {
            playback_id: 0,
            latest_request,
            volume: 1.0,
            desired_playing: false,
            initializing: false,
            initial_seek: None,
            seeking: false,
            buffering_percent: 100,
            audio_sink,
            pipeline: None,
            volume_elem: None,
            state: PlayerState::Idle,
            current_track: None,
            loading_since: None,
            last_progress_emit: None,
            state_mismatch_since: None,
            spectrum_buf: Vec::with_capacity(64),
            buffering_since: None,
        };
        let mut ticker = tokio::time::interval(Duration::from_millis(33));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(request) => {
                            let loading = matches!(&request.command, PlayerCommand::Load { .. });
                            let result = handle_cmd(&mut engine, request.command, &event_tx);
                            // Loading failures are lifecycle events; control failures are RPC errors.
                            // Each failure has one owner and is never reported through both paths.
                            let result = if loading {
                                if let Err(error) = result { fail_playback(&mut engine, &event_tx, error); }
                                Ok(())
                            } else { result };
                            if let Some(response) = request.response { let _ = response.send(result); }
                            // Adapt tick rate: fast when playing (33ms), slow when idle/paused (200ms)
                            let new_period = if matches!(engine.state, PlayerState::Playing { .. }) {
                                Duration::from_millis(33)
                            } else {
                                Duration::from_millis(200)
                            };
                            if ticker.period() != new_period {
                                ticker = tokio::time::interval(new_period);
                                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                            }
                        }
                        None => {
                            teardown(&mut engine);
                            break;
                        }
                    }
                }
                _ = ticker.tick() => {
                    tick_progress(&mut engine, &event_tx);
                    // Also adapt tick rate after progress tick — state may change
                    // via GStreamer bus messages (e.g. Loading→Playing, Error→Stopped)
                    let new_period = if matches!(engine.state, PlayerState::Playing { .. }) {
                        Duration::from_millis(33)
                    } else {
                        Duration::from_millis(200)
                    };
                    if ticker.period() != new_period {
                        ticker = tokio::time::interval(new_period);
                        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                    }
                }
            }
        }
    });

    Ok(())
}

fn handle_cmd(
    eng: &mut Engine,
    cmd: PlayerCommand,
    tx: &broadcast::Sender<PlayerEventEnvelope>,
) -> Result<(), PlayerError> {
    match cmd {
        PlayerCommand::Load {
            playback_id,
            track,
            stream,
            position_ms,
            paused,
        } => {
            if playback_id != eng.latest_request.load(Ordering::SeqCst) {
                return Ok(());
            }
            teardown(eng);
            eng.playback_id = playback_id;
            eng.desired_playing = !paused;
            eng.initializing = true;
            eng.initial_seek = (position_ms > 0).then_some(position_ms);
            eng.buffering_percent = 100;
            let track = Arc::new(track);
            eng.current_track = Some(Arc::clone(&track));
            set_state(eng, PlayerState::Loading { track }, tx);
            let (pipeline, volume) = build_pipeline(&stream, eng.audio_sink)?;
            volume.set_property("volume", eng.volume as f64);
            eng.volume_elem = Some(volume);
            eng.pipeline = Some(pipeline.clone());
            // Preroll before restoring a retry position. The seek belongs to this pipeline.
            let result = pipeline
                .set_state(gst::State::Paused)
                .map_err(|e| PlayerError::Pipeline(format!("failed to preroll: {e}")))?;
            if result == gst::StateChangeSuccess::NoPreroll {
                eng.initial_seek = None;
                finish_initial_load(eng, tx)?;
            }
            Ok(())
        }
        PlayerCommand::SetPaused {
            playback_id,
            paused,
        } => {
            if playback_id != eng.playback_id {
                return Ok(());
            }
            eng.desired_playing = !paused;
            if eng.initializing {
                return Ok(());
            }
            let p = eng
                .pipeline
                .as_ref()
                .ok_or(PlayerError::InvalidState("no pipeline".into()))?;
            let track = eng
                .current_track
                .clone()
                .ok_or(PlayerError::InvalidState("no track".into()))?;
            if paused {
                set_gst_state(p, gst::State::Paused)?;
                let position_ms = pos_ms(p);
                eng.buffering_since = None;
                set_state(eng, PlayerState::Paused { track, position_ms }, tx);
            } else if eng.buffering_percent < 100 {
                eng.buffering_since
                    .get_or_insert_with(std::time::Instant::now);
                set_state(
                    eng,
                    PlayerState::Buffering {
                        track,
                        percent: eng.buffering_percent,
                    },
                    tx,
                );
            } else {
                set_gst_state(p, gst::State::Playing)?;
            }
            Ok(())
        }
        PlayerCommand::Stop { playback_id } => {
            // A stop may precede a newer URL request, but must never stop a newer pipeline.
            if playback_id < eng.playback_id {
                return Ok(());
            }
            teardown(eng);
            eng.playback_id = playback_id;
            set_state(eng, PlayerState::Stopped, tx);
            Ok(())
        }
        PlayerCommand::Seek {
            playback_id,
            position_ms,
        } => {
            if playback_id != eng.playback_id {
                return Ok(());
            }
            if eng.initializing {
                eng.initial_seek = Some(position_ms);
                return Ok(());
            }
            seek_pipeline(eng, position_ms)
        }
        PlayerCommand::SetVolume(v) => {
            eng.volume = v.clamp(0.0, 1.0);
            if let Some(el) = &eng.volume_elem {
                el.set_property("volume", eng.volume as f64);
            }
            Ok(())
        }
    }
}

fn seek_pipeline(eng: &mut Engine, position_ms: u64) -> Result<(), PlayerError> {
    let p = eng
        .pipeline
        .as_ref()
        .ok_or(PlayerError::InvalidState("no pipeline".into()))?;
    p.seek_simple(
        gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
        gst::ClockTime::from_mseconds(position_ms),
    )
    .map_err(|_| PlayerError::Pipeline("seek failed".into()))?;
    eng.seeking = true;
    Ok(())
}

fn finish_initial_load(
    eng: &mut Engine,
    tx: &broadcast::Sender<PlayerEventEnvelope>,
) -> Result<(), PlayerError> {
    // None means no pending seek; an explicit user seek to zero must still run.
    if let Some(position) = eng.initial_seek.take() {
        seek_pipeline(eng, position)?;
        return Ok(());
    }
    eng.initializing = false;
    eng.seeking = false;
    let pipeline = eng
        .pipeline
        .as_ref()
        .ok_or(PlayerError::InvalidState("no pipeline".into()))?;
    let track = eng
        .current_track
        .clone()
        .ok_or(PlayerError::InvalidState("no track".into()))?;
    if !eng.desired_playing {
        let position_ms = pos_ms(pipeline);
        set_state(eng, PlayerState::Paused { track, position_ms }, tx);
    } else if eng.buffering_percent < 100 {
        eng.buffering_since
            .get_or_insert_with(std::time::Instant::now);
        set_state(
            eng,
            PlayerState::Buffering {
                track,
                percent: eng.buffering_percent,
            },
            tx,
        );
    } else {
        set_gst_state(pipeline, gst::State::Playing)?;
    }
    Ok(())
}

fn fail_playback(
    eng: &mut Engine,
    tx: &broadcast::Sender<PlayerEventEnvelope>,
    error: PlayerError,
) {
    emit(tx, eng.playback_id, PlayerEvent::Error { error });
    teardown(eng);
    set_state(eng, PlayerState::Stopped, tx);
}

fn tick_progress(eng: &mut Engine, tx: &broadcast::Sender<PlayerEventEnvelope>) {
    let Some(p) = eng.pipeline.clone() else {
        return;
    };

    // poll bus for EOS / errors / spectrum
    if let Some(bus) = p.bus() {
        while let Some(msg) = bus.timed_pop(gst::ClockTime::ZERO) {
            match msg.view() {
                gst::MessageView::Error(e) => {
                    let detail = format!(
                        "{}{}",
                        e.error(),
                        e.debug().map(|d| format!(" ({d})")).unwrap_or_default()
                    );
                    if let Some(track) = &eng.current_track {
                        log::error!(
                            "gstreamer pipeline error (track id={}, source={:?}): {detail}",
                            track.id,
                            track.source
                        );
                    } else {
                        log::error!("gstreamer pipeline error: {detail}");
                    }
                    fail_playback(eng, tx, PlayerError::Pipeline(detail));
                    return;
                }
                gst::MessageView::Eos(_) => {
                    teardown(eng);
                    set_state(eng, PlayerState::Stopped, tx);
                    emit(tx, eng.playback_id, PlayerEvent::Ended);
                    return;
                }
                gst::MessageView::AsyncDone(_) => {
                    eng.seeking = false;
                    if eng.initializing {
                        if let Err(error) = finish_initial_load(eng, tx) {
                            fail_playback(eng, tx, error);
                            return;
                        }
                    }
                }
                gst::MessageView::StateChanged(sc) => {
                    if sc
                        .src()
                        .map(|s| s == p.upcast_ref::<gst::Object>())
                        .unwrap_or(false)
                        && sc.current() == gst::State::Playing
                        && !eng.initializing
                        && eng.desired_playing
                    {
                        if let Some(track) = eng.current_track.clone() {
                            eng.buffering_since = None;
                            let position_ms = pos_ms(&p);
                            set_state(eng, PlayerState::Playing { track, position_ms }, tx);
                        }
                    }
                }
                gst::MessageView::Element(elem) => {
                    if let Some(s) = elem.structure() {
                        if s.name() == "spectrum" {
                            extract_spectrum_into(s, &mut eng.spectrum_buf);
                            if !eng.spectrum_buf.is_empty() {
                                // One allocation per frame (Arc header + slice), copy 64 floats.
                                emit(
                                    tx,
                                    eng.playback_id,
                                    PlayerEvent::Spectrum {
                                        magnitudes: Arc::from(eng.spectrum_buf.as_slice()),
                                    },
                                );
                            }
                        }
                    }
                }
                gst::MessageView::Warning(w) => {
                    let detail = format!(
                        "{}{}",
                        w.error(),
                        w.debug().map(|d| format!(" ({d})")).unwrap_or_default()
                    );
                    log::warn!("gstreamer pipeline warning: {detail}");
                }
                gst::MessageView::Buffering(b) => {
                    let percent = b.percent().clamp(0, 100);
                    eng.buffering_percent = percent;
                    if !eng.initializing && eng.desired_playing {
                        if percent < 100 {
                            if let Err(error) = set_gst_state(&p, gst::State::Paused) {
                                fail_playback(eng, tx, error);
                                return;
                            }
                            if let Some(track) = eng.current_track.clone() {
                                eng.buffering_since
                                    .get_or_insert_with(std::time::Instant::now);
                                emit(tx, eng.playback_id, PlayerEvent::Buffering { percent });
                                set_state(eng, PlayerState::Buffering { track, percent }, tx);
                            }
                        } else {
                            eng.buffering_since = None;
                            if let Err(error) = set_gst_state(&p, gst::State::Playing) {
                                fail_playback(eng, tx, error);
                                return;
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    if eng.initializing
        && eng
            .loading_since
            .is_some_and(|start| start.elapsed() >= Duration::from_secs(30))
    {
        fail_playback(eng, tx, PlayerError::Stream("loading timeout".into()));
        return;
    }

    // Buffering timeout protection: if buffering exceeds 30s, treat as unrecoverable.
    const BUFFERING_TIMEOUT: Duration = Duration::from_secs(30);
    if matches!(eng.state, PlayerState::Buffering { .. }) {
        if let Some(start) = eng.buffering_since {
            if start.elapsed() >= BUFFERING_TIMEOUT {
                log::error!("buffering timeout >30s, tearing down pipeline");
                fail_playback(eng, tx, PlayerError::Stream("buffering timeout".into()));
                return;
            }
        }
    }

    if matches!(eng.state, PlayerState::Playing { .. }) {
        // Check if pipeline is actually playing (detect silent failures)
        // Use destructuring for better readability
        let (state_change_result, current_state, _pending_state) = p.state(gst::ClockTime::ZERO);

        // Immediately handle critical state change failures
        if state_change_result.is_err() {
            log::error!("pipeline state query failed: {:?}", state_change_result);
            fail_playback(eng, tx, PlayerError::Pipeline("state query failure".into()));
            return;
        }

        // Time-based state mismatch detection (replaces tick-count approach).
        // Fires after mismatch persists for >100ms, independent of tick interval.
        if current_state != gst::State::Playing && current_state != gst::State::Paused {
            let mismatch_start = eng
                .state_mismatch_since
                .get_or_insert_with(std::time::Instant::now);
            if mismatch_start.elapsed() >= Duration::from_millis(100) {
                log::error!(
                    "pipeline state mismatch persisted >100ms: expected Playing, got {:?}",
                    current_state
                );
                fail_playback(
                    eng,
                    tx,
                    PlayerError::Pipeline(format!("unexpected state: {:?}", current_state)),
                );
                return;
            }
        } else {
            eng.state_mismatch_since = None;
        }

        // Time-based progress emission at ~5Hz (every 200ms).
        // Decoupled from tick interval so changing tick rate won't affect progress frequency.
        let now = std::time::Instant::now();
        let should_emit_progress = eng
            .last_progress_emit
            .map(|last| now.duration_since(last) >= Duration::from_millis(200))
            .unwrap_or(true);
        if should_emit_progress && !eng.seeking {
            eng.last_progress_emit = Some(now);
            if let Some(pipeline) = &eng.pipeline {
                let position = pos_ms(pipeline);
                let duration = dur_ms(pipeline);
                emit(
                    tx,
                    eng.playback_id,
                    PlayerEvent::Progress {
                        position_ms: position,
                        duration_ms: duration,
                    },
                );
            }
        }
    }
}

/// Extract spectrum magnitudes into a pre-allocated buffer, avoiding per-frame heap allocation.
fn extract_spectrum_into(structure: &gst::StructureRef, buf: &mut Vec<f32>) {
    buf.clear();
    if let Ok(magnitudes) = structure.get::<gst::List>("magnitude") {
        buf.extend(magnitudes.iter().map(|v| {
            let db = v.get::<f32>().unwrap_or(-80.0);
            ((db + 80.0) / 80.0).clamp(0.0, 1.0)
        }));
    }
}

// --- Pipeline construction ---

fn build_pipeline(
    stream: &StreamInfo,
    audio_sink: &str,
) -> Result<(gst::Pipeline, gst::Element), PlayerError> {
    let pipeline = gst::Pipeline::with_name("rustplayer");

    let make = |factory: &str, name: &str| -> Result<gst::Element, PlayerError> {
        gst::ElementFactory::make(factory)
            .name(name)
            .build()
            .map_err(|_| PlayerError::Pipeline(format!("failed to create {factory}")))
    };

    let src = make("uridecodebin", "source")?;
    src.set_property("uri", &stream.url);
    // Enable buffering for HTTP streams — uridecodebin will emit Buffering messages
    // on the bus so the engine can pause/resume during network stalls.
    src.set_property("use-buffering", true);
    // Increase buffer capacity for unstable networks (default ~2MB is too small).
    src.set_property("buffer-size", 8_i32 * 1024 * 1024); // 8 MB
    src.set_property("buffer-duration", 10_i64 * 1_000_000_000); // 10 seconds

    let convert = make("audioconvert", "convert")?;
    let resample = make("audioresample", "resample")?;
    let spectrum = make("spectrum", "spectrum")?;
    spectrum.set_property("bands", 64u32);
    spectrum.set_property("threshold", -80i32);
    spectrum.set_property("interval", 66_666_667u64); // ~15fps, aligned with event layer
    spectrum.set_property("message-magnitude", true);
    spectrum.set_property("post-messages", true);
    let volume = make("volume", "volume")?;
    let sink = make(audio_sink, "sink")?;

    pipeline
        .add_many([&src, &convert, &resample, &spectrum, &volume, &sink])
        .map_err(|_| PlayerError::Pipeline("failed to add elements".into()))?;

    gst::Element::link_many([&convert, &resample, &spectrum, &volume, &sink])
        .map_err(|_| PlayerError::Pipeline("failed to link elements".into()))?;

    // uridecodebin uses dynamic pads
    let convert_weak = convert.downgrade();
    src.connect_pad_added(move |_, pad| {
        let Some(convert) = convert_weak.upgrade() else {
            return;
        };
        let Some(sink_pad) = convert.static_pad("sink") else {
            return;
        };
        if !sink_pad.is_linked() {
            let _ = pad.link(&sink_pad);
        }
    });

    Ok((pipeline, volume))
}

// --- Helpers ---

fn set_gst_state(pipeline: &gst::Pipeline, state: gst::State) -> Result<(), PlayerError> {
    let started = std::time::Instant::now();
    let result = pipeline
        .set_state(state)
        .map_err(|e| PlayerError::Pipeline(format!("failed to set state {state:?}: {e}")))?;
    let elapsed = started.elapsed();
    if elapsed >= Duration::from_millis(50) {
        log::warn!(
            "set_state({state:?}) took {}ms (result={result:?})",
            elapsed.as_millis()
        );
    } else {
        log::debug!(
            "set_state({state:?}) took {}ms (result={result:?})",
            elapsed.as_millis()
        );
    }
    Ok(())
}

fn pos_ms(pipeline: &gst::Pipeline) -> u64 {
    pipeline
        .query_position::<gst::ClockTime>()
        .map(|t| t.mseconds())
        .unwrap_or(0)
}

fn dur_ms(pipeline: &gst::Pipeline) -> u64 {
    pipeline
        .query_duration::<gst::ClockTime>()
        .map(|t| t.mseconds())
        .unwrap_or(0)
}

fn teardown(eng: &mut Engine) {
    if let Some(p) = eng.pipeline.take() {
        let _ = p.set_state(gst::State::Null);
    }
    eng.volume_elem = None;
    eng.current_track = None;
    eng.loading_since = None;
    // Reset time-based tracking to avoid stale state leaking to next track
    eng.last_progress_emit = None;
    eng.state_mismatch_since = None;
    eng.buffering_since = None;
    eng.initializing = false;
    eng.initial_seek = None;
    eng.seeking = false;
    eng.desired_playing = false;
}

fn set_state(eng: &mut Engine, state: PlayerState, tx: &broadcast::Sender<PlayerEventEnvelope>) {
    if matches!(state, PlayerState::Loading { .. }) {
        eng.loading_since = Some(std::time::Instant::now());
    } else {
        eng.loading_since = None;
    }
    eng.state = state.clone();
    emit(tx, eng.playback_id, PlayerEvent::StateChanged { state });
}

fn emit(tx: &broadcast::Sender<PlayerEventEnvelope>, playback_id: PlaybackId, event: PlayerEvent) {
    let _ = tx.send(PlayerEventEnvelope { playback_id, event });
}

#[cfg(test)]
mod tests {
    use super::*;

    struct AudioFixture(std::path::PathBuf);
    impl AudioFixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "shiyin-playback-{}-{}.wav",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let data_size = 8000_u32 * 2 * 3;
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
            bytes.extend_from_slice(b"WAVEfmt ");
            bytes.extend_from_slice(&16_u32.to_le_bytes());
            bytes.extend_from_slice(&1_u16.to_le_bytes());
            bytes.extend_from_slice(&1_u16.to_le_bytes());
            bytes.extend_from_slice(&8000_u32.to_le_bytes());
            bytes.extend_from_slice(&16000_u32.to_le_bytes());
            bytes.extend_from_slice(&2_u16.to_le_bytes());
            bytes.extend_from_slice(&16_u16.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&data_size.to_le_bytes());
            bytes.resize(bytes.len() + data_size as usize, 0);
            std::fs::write(&path, bytes).unwrap();
            Self(path)
        }
        fn stream(&self) -> StreamInfo {
            StreamInfo {
                url: format!("file://{}", self.0.display()),
                format: "wav".into(),
                bitrate: None,
            }
        }
    }
    impl Drop for AudioFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    fn track() -> Track {
        Track {
            id: "fixture".into(),
            name: "fixture".into(),
            artist: "fixture".into(),
            album: "fixture".into(),
            duration_ms: 3000,
            source: rustplayer_core::MusicSourceId::Netease,
            cover_url: None,
            media_mid: None,
        }
    }
    async fn until(
        rx: &mut broadcast::Receiver<PlayerEventEnvelope>,
        predicate: impl Fn(&PlayerEventEnvelope) -> bool,
    ) -> PlayerEventEnvelope {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let event = rx.recv().await.expect("engine event channel stays open");
                if predicate(&event) {
                    return event;
                }
                if let PlayerEvent::Error { error } = event.event {
                    panic!("unexpected engine failure: {error}");
                }
            }
        })
        .await
        .expect("expected playback event within timeout")
    }
    fn paused(event: &PlayerEventEnvelope, id: u64) -> bool {
        event.playback_id == id
            && matches!(
                event.event,
                PlayerEvent::StateChanged {
                    state: PlayerState::Paused { .. }
                }
            )
    }

    #[test]
    fn seek_to_zero_during_initial_restore_overrides_the_resume_position() {
        gst::init().unwrap();
        let audio = AudioFixture::new();
        let (tx, mut events) = broadcast::channel(256);
        let mut eng = Engine {
            playback_id: 0,
            latest_request: Arc::new(AtomicU64::new(1)),
            volume: 1.0,
            desired_playing: false,
            initializing: false,
            initial_seek: None,
            seeking: false,
            buffering_percent: 100,
            audio_sink: "fakesink",
            pipeline: None,
            volume_elem: None,
            state: PlayerState::Idle,
            current_track: None,
            loading_since: None,
            last_progress_emit: None,
            state_mismatch_since: None,
            spectrum_buf: Vec::with_capacity(64),
            buffering_since: None,
        };
        handle_cmd(
            &mut eng,
            PlayerCommand::Load {
                playback_id: 1,
                track: track(),
                stream: audio.stream(),
                position_ms: 1000,
                paused: true,
            },
            &tx,
        )
        .unwrap();
        let pipeline = eng.pipeline.clone().unwrap();
        let bus = pipeline.bus().unwrap();
        // Stop at the first real AsyncDone so a user command can arrive while restoration is pending.
        loop {
            let message = bus
                .timed_pop(gst::ClockTime::from_seconds(5))
                .expect("preroll completes");
            match message.view() {
                gst::MessageView::AsyncDone(_) => break,
                gst::MessageView::Error(error) => panic!("preroll failed: {error:?}"),
                _ => {}
            }
        }
        finish_initial_load(&mut eng, &tx).unwrap();
        handle_cmd(
            &mut eng,
            PlayerCommand::Seek {
                playback_id: 1,
                position_ms: 0,
            },
            &tx,
        )
        .unwrap();

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while eng.initializing && std::time::Instant::now() < deadline {
            tick_progress(&mut eng, &tx);
            std::thread::sleep(Duration::from_millis(1));
        }
        let position = pos_ms(&pipeline);
        let state = eng.state.clone();
        teardown(&mut eng);
        assert!(
            position < 50,
            "user requested 0ms but pipeline stopped at {position}ms"
        );
        assert!(matches!(state, PlayerState::Paused { position_ms, .. } if position_ms < 50));
        let mut saw_paused = false;
        while let Ok(event) = events.try_recv() {
            assert_eq!(event.playback_id, 1);
            match event.event {
                PlayerEvent::StateChanged {
                    state: PlayerState::Paused { position_ms, .. },
                } => {
                    assert!(
                        position_ms < 50,
                        "paused event reported an obsolete position"
                    );
                    saw_paused = true;
                }
                PlayerEvent::Error { error } => panic!("unexpected playback failure: {error}"),
                _ => {}
            }
        }
        assert!(saw_paused);
    }

    #[tokio::test]
    async fn only_latest_reserved_load_reaches_the_engine() {
        let player = Player::with_audio_sink("fakesink").unwrap();
        let mut events = player.subscribe();
        assert!(player.reserve_request(1));
        assert!(player.reserve_request(2));
        assert!(!player.reserve_request(1));
        assert!(!player.reserve_request(2));
        let missing = StreamInfo {
            url: format!(
                "file:///tmp/shiyin-missing-{}-{}.wav",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ),
            format: "wav".into(),
            bitrate: None,
        };
        player
            .send(PlayerCommand::Load {
                playback_id: 1,
                track: track(),
                stream: missing.clone(),
                position_ms: 0,
                paused: false,
            })
            .await
            .unwrap();
        player
            .send(PlayerCommand::Load {
                playback_id: 2,
                track: track(),
                stream: missing,
                position_ms: 0,
                paused: false,
            })
            .await
            .unwrap();
        let event = until(&mut events, |_| true).await;
        assert_eq!(event.playback_id, 2);
        assert!(matches!(
            event.event,
            PlayerEvent::StateChanged {
                state: PlayerState::Loading { .. }
            }
        ));
        let failure = until(&mut events, |event| {
            matches!(event.event, PlayerEvent::Error { .. })
        })
        .await;
        assert_eq!(failure.playback_id, 2);
        let stop = until(&mut events, |event| {
            matches!(
                event.event,
                PlayerEvent::StateChanged {
                    state: PlayerState::Stopped
                }
            )
        })
        .await;
        assert_eq!(stop.playback_id, 2);
    }

    #[tokio::test]
    async fn real_pipeline_restores_position_while_paused_then_emits_ended() {
        let audio = AudioFixture::new();
        let player = Player::with_audio_sink("fakesink").unwrap();
        let mut events = player.subscribe();
        player.reserve_request(10);
        player
            .send(PlayerCommand::Load {
                playback_id: 10,
                track: track(),
                stream: audio.stream(),
                position_ms: 1000,
                paused: true,
            })
            .await
            .unwrap();
        let event = until(&mut events, |event| paused(event, 10)).await;
        let PlayerEvent::StateChanged {
            state: PlayerState::Paused { position_ms, .. },
        } = event.event
        else {
            unreachable!()
        };
        assert!(
            (950..=1050).contains(&position_ms),
            "restored position was {position_ms}"
        );
        player
            .send(PlayerCommand::SetPaused {
                playback_id: 10,
                paused: false,
            })
            .await
            .unwrap();
        let ended = until(&mut events, |event| {
            matches!(event.event, PlayerEvent::Ended)
        })
        .await;
        assert_eq!(ended.playback_id, 10);
    }

    #[tokio::test]
    async fn old_controls_and_stop_do_not_change_the_new_pipeline() {
        let audio = AudioFixture::new();
        let player = Player::with_audio_sink("fakesink").unwrap();
        let mut events = player.subscribe();
        player.reserve_request(2);
        player
            .send(PlayerCommand::Load {
                playback_id: 2,
                track: track(),
                stream: audio.stream(),
                position_ms: 0,
                paused: true,
            })
            .await
            .unwrap();
        until(&mut events, |event| paused(event, 2)).await;
        player
            .send(PlayerCommand::Seek {
                playback_id: 1,
                position_ms: 2500,
            })
            .await
            .unwrap();
        player
            .send(PlayerCommand::SetPaused {
                playback_id: 1,
                paused: false,
            })
            .await
            .unwrap();
        player
            .send(PlayerCommand::Stop { playback_id: 1 })
            .await
            .unwrap();
        assert!(
            events.try_recv().is_err(),
            "old controls must not emit new state changes"
        );
        player.reserve_request(3);
        player
            .send(PlayerCommand::Stop { playback_id: 3 })
            .await
            .unwrap();
        let stopped = until(&mut events, |_| true).await;
        assert_eq!(stopped.playback_id, 3);
        assert!(matches!(
            stopped.event,
            PlayerEvent::StateChanged {
                state: PlayerState::Stopped
            }
        ));
        assert!(player
            .send(PlayerCommand::Seek {
                playback_id: 3,
                position_ms: 10
            })
            .await
            .is_err());
        assert!(
            events.try_recv().is_err(),
            "control errors must be returned through RPC only"
        );
    }
}
