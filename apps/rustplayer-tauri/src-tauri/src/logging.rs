use std::path::Path;
use std::sync::OnceLock;

use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

static FILE_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

/// Maximum number of days to retain log files.
const LOG_RETENTION_DAYS: u64 = 7;

pub fn init(app_data_dir: &Path) -> Result<(), String> {
    // Keep file logs even in release/Windows where stdout may be invisible.
    let log_dir = app_data_dir.join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("create log dir {log_dir:?}: {e}"))?;

    // Clean up old log files beyond retention period.
    cleanup_old_logs(&log_dir);

    let file_appender = tracing_appender::rolling::daily(&log_dir, "rustplayer-backend.jsonl");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let _ = FILE_GUARD.set(guard);

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    let stdout_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_thread_ids(true)
        .with_thread_names(true)
        .with_ansi(true)
        .compact();

    // JSONL on disk for easy grep/parse; spans carry `trace_id` for end-to-end correlation.
    let file_layer = tracing_subscriber::fmt::layer()
        .json()
        .with_target(true)
        .with_thread_ids(true)
        .with_thread_names(true)
        .with_ansi(false)
        .with_current_span(true)
        .with_span_list(true)
        .with_writer(file_writer);

    // .init() internally calls both set_global_default() and LogTracer::init(),
    // so we must NOT call LogTracer::init() separately.
    tracing_subscriber::registry()
        .with(filter)
        .with(stdout_layer)
        .with(file_layer)
        .init();

    // Ensure panics get into the log file (tokio tasks can otherwise drop JoinError silently).
    std::panic::set_hook(Box::new(|info| {
        tracing::error!(panic = %info, "panic");
    }));

    tracing::info!(log_dir = %log_dir.display(), "logging initialized");
    Ok(())
}

fn cleanup_old_logs(log_dir: &Path) {
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(LOG_RETENTION_DAYS * 24 * 3600);

    let entries = match std::fs::read_dir(log_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        // Only clean up log files matching our naming pattern.
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("rustplayer-backend.jsonl") {
            continue;
        }
        if let Ok(meta) = path.metadata() {
            let modified = meta.modified().unwrap_or(std::time::SystemTime::now());
            if modified < cutoff {
                if let Err(e) = std::fs::remove_file(&path) {
                    eprintln!("failed to remove old log {path:?}: {e}");
                }
            }
        }
    }
}

