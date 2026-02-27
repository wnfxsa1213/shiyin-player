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
    current_track: Option<Track>,
    progress_counter: u32,
    state_mismatch_count: u32,
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
            progress_counter: 0,
            state_mismatch_count: 0,
        };
        let mut ticker = tokio::time::interval(Duration::from_millis(33));

        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(c) => {
                            if let Err(e) = handle_cmd(&mut engine, c, &event_tx) {
                                emit(&event_tx, PlayerEvent::Error { error: e });
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
            let (pipeline, vol) = build_pipeline(&stream)?;
            eng.pipeline = Some(pipeline);
            eng.volume_elem = Some(vol);
            eng.current_track = Some(track.clone());
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
                                if let Some(track) = eng.current_track.clone() {
                                    eng.state = PlayerState::Playing { track: track.clone(), position_ms: 0 };
                                    emit(tx, PlayerEvent::StateChanged { state: eng.state.clone() });
                                }
                            }
                        }
                    }
                }
                gst::MessageView::Element(elem) => {
                    if let Some(s) = elem.structure() {
                        if s.name() == "spectrum" {
                            if let Some(magnitudes) = extract_spectrum(s) {
                                emit(tx, PlayerEvent::Spectrum { magnitudes });
                            }
                        }
                    }
                }
                gst::MessageView::Warning(w) => {
                    let detail = format!("{}{}", w.error(), w.debug().map(|d| format!(" ({d})")).unwrap_or_default());
                    log::warn!("gstreamer pipeline warning: {detail}");
                }
                _ => {}
            }
        }
    }

    if matches!(eng.state, PlayerState::Playing { .. }) {
        // Check if pipeline is actually playing (detect silent failures)
        // Use a counter to avoid false positives during transient state changes
        if let Ok(state) = p.state(gst::ClockTime::ZERO) {
            if state.1 != gst::State::Playing && state.1 != gst::State::Paused {
                eng.state_mismatch_count += 1;
                if eng.state_mismatch_count >= 3 {
                    log::error!("pipeline state mismatch (3 consecutive): expected Playing, got {:?}", state.1);
                    emit(tx, PlayerEvent::Error {
                        error: PlayerError::Pipeline(format!("unexpected state: {:?}", state.1))
                    });
                    teardown(eng);
                    set_state(eng, PlayerState::Stopped, tx);
                    return;
                }
            } else {
                // Reset counter when state is correct
                eng.state_mismatch_count = 0;
            }
        }

        // Emit Progress at ~2Hz (every ~15 ticks at 33ms interval)
        eng.progress_counter += 1;
        if eng.progress_counter >= 15 {
            eng.progress_counter = 0;
            if let Some(pipeline) = &eng.pipeline {
                let position = pos_ms(pipeline);
                let duration = dur_ms(pipeline);
                emit(tx, PlayerEvent::Progress { position_ms: position, duration_ms: duration });
            }
        }
    }
}

fn extract_spectrum(structure: &gst::StructureRef) -> Option<Vec<f32>> {
    let magnitudes = structure.get::<gst::List>("magnitude").ok()?;
    let result: Vec<f32> = magnitudes
        .iter()
        .map(|v| {
            let db = v.get::<f32>().unwrap_or(-80.0);
            // Map dB range [-80, 0] to [0.0, 1.0]
            ((db + 80.0) / 80.0).clamp(0.0, 1.0)
        })
        .collect();
    Some(result)
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

    let convert = make("audioconvert", "convert")?;
    let resample = make("audioresample", "resample")?;
    let spectrum = make("spectrum", "spectrum")?;
    spectrum.set_property("bands", 64u32);
    spectrum.set_property("threshold", -80i32);
    spectrum.set_property("interval", 33_333_333u64); // ~30fps
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
    pipeline.set_state(state).map_err(|e| PlayerError::Pipeline(format!("failed to set state {state:?}: {e}")))?;
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
}

fn set_state(eng: &mut Engine, state: PlayerState, tx: &broadcast::Sender<PlayerEvent>) {
    eng.state = state.clone();
    emit(tx, PlayerEvent::StateChanged { state });
}

fn emit(tx: &broadcast::Sender<PlayerEvent>, event: PlayerEvent) {
    let _ = tx.send(event);
}
