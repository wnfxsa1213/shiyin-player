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
    // Example: 18f3c8f3b2a-2a
    format!("{ms:x}-{seq:x}")
}

pub fn command_span(cmd: &'static str, trace_id: &str) -> tracing::Span {
    tracing::info_span!("ipc", cmd = cmd, trace_id = trace_id)
}

