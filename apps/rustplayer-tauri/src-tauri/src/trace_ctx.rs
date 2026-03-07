use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TRACE_SEQ: AtomicU64 = AtomicU64::new(1);

pub fn ensure_trace_id(trace_id: Option<String>) -> String {
    trace_id.unwrap_or_else(new_trace_id)
}

pub fn new_trace_id() -> String {
    let seq = TRACE_SEQ.fetch_add(1, Ordering::Relaxed);
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // Pre-allocate: typical trace_id is ~15-20 hex chars
    let mut buf = String::with_capacity(24);
    use std::fmt::Write;
    let _ = write!(buf, "{ms:x}-{seq:x}");
    buf
}

/// Creates a tracing span for an IPC command.
/// High-frequency commands (seek, set_volume) use debug level to avoid span
/// overhead when the subscriber is configured at INFO (the default).
pub fn command_span(cmd: &'static str, trace_id: &str) -> tracing::Span {
    match cmd {
        "seek" | "set_volume" => tracing::debug_span!("ipc", cmd = cmd, trace_id = trace_id),
        _ => tracing::info_span!("ipc", cmd = cmd, trace_id = trace_id),
    }
}

