use std::sync::Arc;
use std::time::Duration;

use gstreamer as gst;
use gst::prelude::*;
use rustplayer_core::{PlayerCommand, PlayerError, PlayerEvent, PlayerState, StreamInfo, Track};
use tokio::sync::{broadcast, mpsc};

pub struct Player {
    cmd_tx: Option<mpsc::Sender<PlayerCommand>>,
    event_tx: broadcast::Sender<PlayerEvent>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Player {
    pub fn new() -> Result<Self, PlayerError> {
        let (cmd_tx, cmd_rx) = mpsc::channel::<PlayerCommand>(64);
        let (event_tx, _) = broadcast::channel::<PlayerEvent>(256);
        let tx = event_tx.clone();

        let handle = std::thread::Builder::new()
            .name("gstreamer-engine".into())
            .spawn(move || {
                if let Err(e) = engine_loop(cmd_rx, tx) {
                    log::error!("player engine error: {e}");
                }
            })
            .map_err(|e| PlayerError::Internal(e.to_string()))?;

        Ok(Self {
            cmd_tx: Some(cmd_tx),
            event_tx,
            thread: Some(handle),
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PlayerEvent> {
        self.event_tx.subscribe()
    }

    pub async fn send(&self, cmd: PlayerCommand) -> Result<(), PlayerError> {
        self.cmd_tx.as_ref().ok_or(PlayerError::ChannelClosed)?
            .send(cmd).await.map_err(|_| PlayerError::ChannelClosed)
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
    mut cmd_rx: mpsc::Receiver<PlayerCommand>,
    event_tx: broadcast::Sender<PlayerEvent>,
) -> Result<(), PlayerError> {
    gst::init().map_err(|e| PlayerError::Pipeline(e.to_string()))?;

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .map_err(|e| PlayerError::Internal(e.to_string()))?;

    rt.block_on(async {
        let mut engine = Engine {
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
                        Some(c) => {
                            if let Err(e) = handle_cmd(&mut engine, c, &event_tx) {
                                emit(&event_tx, PlayerEvent::Error { error: e });
                            }
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
    tx: &broadcast::Sender<PlayerEvent>,
) -> Result<(), PlayerError> {
    match cmd {
        PlayerCommand::Load(track, stream) => {
            teardown(eng);
            let build_started = std::time::Instant::now();
            let (pipeline, vol) = build_pipeline(&stream)?;
            let build_ms = build_started.elapsed().as_millis() as u64;
            log::info!("build_pipeline took {build_ms}ms (track id={}, source={:?})", track.id, track.source);
            eng.pipeline = Some(pipeline);
            eng.volume_elem = Some(vol);
            let track = Arc::new(track);
            eng.current_track = Some(Arc::clone(&track));
            set_state(eng, PlayerState::Loading { track }, tx);
            if let Some(p) = &eng.pipeline {
                set_gst_state(p, gst::State::Playing)?;
            }
            Ok(())
        }
        PlayerCommand::Play => {
            let p = eng.pipeline.as_ref().ok_or(PlayerError::InvalidState("no pipeline".into()))?;
            let track = eng.current_track.clone().ok_or(PlayerError::InvalidState("no track".into()))?;
            set_gst_state(p, gst::State::Playing)?;
            set_state(eng, PlayerState::Playing { track, position_ms: pos_ms(p) }, tx);
            Ok(())
        }
        PlayerCommand::Pause => {
            let p = eng.pipeline.as_ref().ok_or(PlayerError::InvalidState("no pipeline".into()))?;
            let track = eng.current_track.clone().ok_or(PlayerError::InvalidState("no track".into()))?;
            set_gst_state(p, gst::State::Paused)?;
            set_state(eng, PlayerState::Paused { track, position_ms: pos_ms(p) }, tx);
            Ok(())
        }
        PlayerCommand::Toggle => {
            let p = eng.pipeline.as_ref().ok_or(PlayerError::InvalidState("no pipeline".into()))?;
            let track = eng.current_track.clone().ok_or(PlayerError::InvalidState("no track".into()))?;
            match eng.state {
                PlayerState::Playing { .. } => {
                    set_gst_state(p, gst::State::Paused)?;
                    set_state(eng, PlayerState::Paused { track, position_ms: pos_ms(p) }, tx);
                }
                _ => {
                    set_gst_state(p, gst::State::Playing)?;
                    set_state(eng, PlayerState::Playing { track, position_ms: pos_ms(p) }, tx);
                }
            }
            Ok(())
        }
        PlayerCommand::Stop => {
            teardown(eng);
            set_state(eng, PlayerState::Stopped, tx);
            Ok(())
        }
        PlayerCommand::Seek(ms) => {
            let p = eng.pipeline.as_ref().ok_or(PlayerError::InvalidState("no pipeline".into()))?;
            p.seek_simple(gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT, gst::ClockTime::from_mseconds(ms))
                .map_err(|_| PlayerError::Pipeline("seek failed".into()))?;
            Ok(())
        }
        PlayerCommand::SetVolume(v) => {
            if let Some(el) = &eng.volume_elem {
                el.set_property("volume", v.clamp(0.0, 1.0) as f64);
            }
            Ok(())
        }
    }
}

fn tick_progress(eng: &mut Engine, tx: &broadcast::Sender<PlayerEvent>) {
    let Some(p) = &eng.pipeline else { return };

    // poll bus for EOS / errors / spectrum
    if let Some(bus) = p.bus() {
        while let Some(msg) = bus.timed_pop(gst::ClockTime::ZERO) {
            match msg.view() {
                gst::MessageView::Error(e) => {
                    let detail = format!("{}{}", e.error(), e.debug().map(|d| format!(" ({d})")).unwrap_or_default());
                    if let Some(track) = &eng.current_track {
                        log::error!(
                            "gstreamer pipeline error (track id={}, source={:?}): {detail}",
                            track.id,
                            track.source
                        );
                    } else {
                        log::error!("gstreamer pipeline error: {detail}");
                    }
                    emit(tx, PlayerEvent::Error { error: PlayerError::Pipeline(detail) });
                    teardown(eng);
                    set_state(eng, PlayerState::Stopped, tx);
                    return;
                }
                gst::MessageView::Eos(_) => {
                    teardown(eng);
                    set_state(eng, PlayerState::Stopped, tx);
                    return;
                }
                gst::MessageView::StateChanged(sc) => {
                    if sc.src().map(|s| s == p.upcast_ref::<gst::Object>()).unwrap_or(false) {
                        if sc.current() == gst::State::Playing {
                            if matches!(eng.state, PlayerState::Loading { .. }) {
                                if let Some(since) = eng.loading_since.take() {
                                    let ms = since.elapsed().as_millis() as u64;
                                    if let Some(track) = &eng.current_track {
                                        log::info!(
                                            "pipeline reached Playing after {ms}ms (track id={}, source={:?})",
                                            track.id, track.source
                                        );
                                    } else {
                                        log::info!("pipeline reached Playing after {ms}ms");
                                    }
                                }
                                if let Some(track) = eng.current_track.clone() {
                                    // Inline set_state to avoid borrow conflict with `p`
                                    eng.loading_since = None;
                                    eng.state = PlayerState::Playing { track, position_ms: 0 };
                                    emit(tx, PlayerEvent::StateChanged { state: eng.state.clone() });
                                }
                            }
                        }
                    }
                }
                gst::MessageView::Element(elem) => {
                    if let Some(s) = elem.structure() {
                        if s.name() == "spectrum" {
                            extract_spectrum_into(s, &mut eng.spectrum_buf);
                            if !eng.spectrum_buf.is_empty() {
                                // One allocation per frame (Arc header + slice), copy 64 floats.
                                emit(tx, PlayerEvent::Spectrum { magnitudes: Arc::from(eng.spectrum_buf.as_slice()) });
                            }
                        }
                    }
                }
                gst::MessageView::Warning(w) => {
                    let detail = format!("{}{}", w.error(), w.debug().map(|d| format!(" ({d})")).unwrap_or_default());
                    log::warn!("gstreamer pipeline warning: {detail}");
                }
                gst::MessageView::Buffering(b) => {
                    let percent = b.percent();
                    if percent < 100 {
                        if let Err(e) = p.set_state(gst::State::Paused) {
                            log::warn!("failed to pause pipeline during buffering: {e}");
                        }
                        // Only enter Buffering state from Playing or Loading (don't override user Pause).
                        if matches!(eng.state, PlayerState::Playing { .. } | PlayerState::Loading { .. }) {
                            if let Some(track) = eng.current_track.clone() {
                                eng.state = PlayerState::Buffering { track, percent };
                                emit(tx, PlayerEvent::Buffering { percent });
                                emit(tx, PlayerEvent::StateChanged { state: eng.state.clone() });
                            }
                            if eng.buffering_since.is_none() {
                                eng.buffering_since = Some(std::time::Instant::now());
                            }
                        }
                        log::debug!("buffering: {percent}%");
                    } else {
                        eng.buffering_since = None;
                        // Resume playback when buffer is full — covers both Loading
                        // (first play), Playing, and Buffering (mid-stream rebuffer) states.
                        if matches!(eng.state, PlayerState::Loading { .. } | PlayerState::Playing { .. } | PlayerState::Buffering { .. }) {
                            if let Err(e) = p.set_state(gst::State::Playing) {
                                log::warn!("failed to resume pipeline after buffering: {e}");
                            }
                            // Restore Playing state after buffering completes.
                            if matches!(eng.state, PlayerState::Buffering { .. }) {
                                if let Some(track) = eng.current_track.clone() {
                                    let position_ms = pos_ms(p);
                                    eng.state = PlayerState::Playing { track, position_ms };
                                    emit(tx, PlayerEvent::StateChanged { state: eng.state.clone() });
                                }
                            }
                        }
                        log::debug!("buffering complete");
                    }
                }
                _ => {}
            }
        }
    }

    // Buffering timeout protection: if buffering exceeds 30s, treat as unrecoverable.
    const BUFFERING_TIMEOUT: Duration = Duration::from_secs(30);
    if matches!(eng.state, PlayerState::Buffering { .. }) {
        if let Some(start) = eng.buffering_since {
            if start.elapsed() >= BUFFERING_TIMEOUT {
                log::error!("buffering timeout >30s, tearing down pipeline");
                emit(tx, PlayerEvent::Error {
                    error: PlayerError::Stream("buffering timeout".into()),
                });
                teardown(eng);
                set_state(eng, PlayerState::Stopped, tx);
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
            emit(tx, PlayerEvent::Error {
                error: PlayerError::Pipeline("state query failure".into())
            });
            teardown(eng);
            set_state(eng, PlayerState::Stopped, tx);
            return;
        }

        // Time-based state mismatch detection (replaces tick-count approach).
        // Fires after mismatch persists for >100ms, independent of tick interval.
        if current_state != gst::State::Playing && current_state != gst::State::Paused {
            let mismatch_start = eng.state_mismatch_since.get_or_insert_with(std::time::Instant::now);
            if mismatch_start.elapsed() >= Duration::from_millis(100) {
                log::error!("pipeline state mismatch persisted >100ms: expected Playing, got {:?}", current_state);
                emit(tx, PlayerEvent::Error {
                    error: PlayerError::Pipeline(format!("unexpected state: {:?}", current_state))
                });
                teardown(eng);
                set_state(eng, PlayerState::Stopped, tx);
                return;
            }
        } else {
            eng.state_mismatch_since = None;
        }

        // Time-based progress emission at ~5Hz (every 200ms).
        // Decoupled from tick interval so changing tick rate won't affect progress frequency.
        let now = std::time::Instant::now();
        let should_emit_progress = eng.last_progress_emit
            .map(|last| now.duration_since(last) >= Duration::from_millis(200))
            .unwrap_or(true);
        if should_emit_progress {
            eng.last_progress_emit = Some(now);
            if let Some(pipeline) = &eng.pipeline {
                let position = pos_ms(pipeline);
                let duration = dur_ms(pipeline);
                emit(tx, PlayerEvent::Progress { position_ms: position, duration_ms: duration });
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

fn build_pipeline(stream: &StreamInfo) -> Result<(gst::Pipeline, gst::Element), PlayerError> {
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
    let sink = make("autoaudiosink", "sink")?;

    pipeline
        .add_many([&src, &convert, &resample, &spectrum, &volume, &sink])
        .map_err(|_| PlayerError::Pipeline("failed to add elements".into()))?;

    gst::Element::link_many([&convert, &resample, &spectrum, &volume, &sink])
        .map_err(|_| PlayerError::Pipeline("failed to link elements".into()))?;

    // uridecodebin uses dynamic pads
    let convert_weak = convert.downgrade();
    src.connect_pad_added(move |_, pad| {
        let Some(convert) = convert_weak.upgrade() else { return };
        let Some(sink_pad) = convert.static_pad("sink") else { return };
        if !sink_pad.is_linked() {
            let _ = pad.link(&sink_pad);
        }
    });

    Ok((pipeline, volume))
}

// --- Helpers ---

fn set_gst_state(pipeline: &gst::Pipeline, state: gst::State) -> Result<(), PlayerError> {
    let started = std::time::Instant::now();
    let result = pipeline.set_state(state)
        .map_err(|e| PlayerError::Pipeline(format!("failed to set state {state:?}: {e}")))?;
    let elapsed = started.elapsed();
    if elapsed >= Duration::from_millis(50) {
        log::warn!("set_state({state:?}) took {}ms (result={result:?})", elapsed.as_millis());
    } else {
        log::debug!("set_state({state:?}) took {}ms (result={result:?})", elapsed.as_millis());
    }
    Ok(())
}

fn pos_ms(pipeline: &gst::Pipeline) -> u64 {
    pipeline.query_position::<gst::ClockTime>().map(|t| t.mseconds()).unwrap_or(0)
}

fn dur_ms(pipeline: &gst::Pipeline) -> u64 {
    pipeline.query_duration::<gst::ClockTime>().map(|t| t.mseconds()).unwrap_or(0)
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
}

fn set_state(eng: &mut Engine, state: PlayerState, tx: &broadcast::Sender<PlayerEvent>) {
    if matches!(state, PlayerState::Loading { .. }) {
        eng.loading_since = Some(std::time::Instant::now());
    } else {
        eng.loading_since = None;
    }
    eng.state = state.clone();
    emit(tx, PlayerEvent::StateChanged { state });
}

fn emit(tx: &broadcast::Sender<PlayerEvent>, event: PlayerEvent) {
    let _ = tx.send(event);
}
