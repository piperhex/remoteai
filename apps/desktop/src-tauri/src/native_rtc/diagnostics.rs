//! Test-only send-stage counters and window control for the isolated RTC harness.
use super::{boundary, model::MAX_MESSAGE_BYTES, State};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub(super) struct SendMetrics {
    lock_ns: AtomicU64,
    window_ns: AtomicU64,
    io_ns: AtomicU64,
    waits: AtomicU64,
    packets: AtomicU64,
    bytes: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SendSample {
    lock_ms: f64,
    window_ms: f64,
    io_ms: f64,
    waits: u64,
    packets: u64,
    bytes: u64,
}

impl SendMetrics {
    pub(super) fn lock(&self, elapsed: std::time::Duration) {
        self.lock_ns
            .fetch_add(elapsed.as_nanos() as u64, Ordering::Relaxed);
    }

    pub(super) fn wait(&self, elapsed: std::time::Duration) {
        self.window_ns
            .fetch_add(elapsed.as_nanos() as u64, Ordering::Relaxed);
        self.waits.fetch_add(1, Ordering::Relaxed);
    }

    pub(super) fn sent(&self, bytes: usize, elapsed: std::time::Duration) {
        self.io_ns
            .fetch_add(elapsed.as_nanos() as u64, Ordering::Relaxed);
        self.packets.fetch_add(1, Ordering::Relaxed);
        self.bytes.fetch_add(bytes as u64, Ordering::Relaxed);
    }

    pub(super) fn snapshot(&self, reset: bool) -> SendSample {
        let read = |counter: &AtomicU64| {
            if reset {
                counter.swap(0, Ordering::Relaxed)
            } else {
                counter.load(Ordering::Relaxed)
            }
        };
        SendSample {
            lock_ms: read(&self.lock_ns) as f64 / 1_000_000.0,
            window_ms: read(&self.window_ns) as f64 / 1_000_000.0,
            io_ms: read(&self.io_ns) as f64 / 1_000_000.0,
            waits: read(&self.waits),
            packets: read(&self.packets),
            bytes: read(&self.bytes),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Request {
    peer: String,
    channel: String,
    window: Option<Window>,
    reset: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Window {
    high: usize,
    low: usize,
}

#[tauri::command]
pub(super) async fn native_rtc_fixture_channel(
    window: tauri::Webview,
    state: tauri::State<'_, State>,
    request: Request,
) -> Result<SendSample, String> {
    super::authorize(&window)?;
    let peer = state
        .get(window.label(), &request.peer)
        .await
        .map_err(boundary)?;
    let channel = peer.channel(&request.channel).await.map_err(boundary)?;
    if let Some(window) = request.window {
        if !(MAX_MESSAGE_BYTES..=4 * 1024 * 1024).contains(&window.high)
            || window.low > window.high - MAX_MESSAGE_BYTES
        {
            return Err(boundary(super::Error::Invalid));
        }
        channel.test_watermarks(window.high, window.low).await;
    }
    Ok(channel.metrics.snapshot(request.reset))
}
