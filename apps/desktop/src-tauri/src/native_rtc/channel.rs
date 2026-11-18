use super::{model::*, peer::Peer};
use bytes::Bytes;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{Mutex, Notify};
use webrtc::data_channel::{data_channel_state::RTCDataChannelState, RTCDataChannel};

// webrtc-sctp releases buffered bytes on ACK, so this bounds in-flight data as well as queued data.
// Keep sustained transfers fed across Wi-Fi RTTs; remote-desktop controls retain their smaller budget.
const FILE_HIGH_WATER_BYTES: usize = 1024 * 1024;
const FILE_LOW_WATER_BYTES: usize = 768 * 1024;
// Chat's compatible hex encoding doubles wire bytes. Refill before ACKs drain most of the window.
// A 512 KiB cap improved phone throughput without the stalls observed with a 1 MiB chat window.
const CHAT_HIGH_WATER_BYTES: usize = 512 * 1024;
const CHAT_LOW_WATER_BYTES: usize = 384 * 1024;

fn watermarks(label: &str) -> (usize, usize) {
    if matches!(label, "remote-ai-file-v1" | "remote-ai-sync-v1") {
        (FILE_HIGH_WATER_BYTES, FILE_LOW_WATER_BYTES)
    } else if label == "codex-chat-v1" {
        (CHAT_HIGH_WATER_BYTES, CHAT_LOW_WATER_BYTES)
    } else {
        (HIGH_WATER_BYTES, LOW_WATER_BYTES)
    }
}

pub(super) struct Channel {
    pub spec: ChannelSpec,
    pub rtc: Arc<RTCDataChannel>,
    outgoing: Mutex<()>,
    writable: Notify,
    high_water: AtomicUsize,
    #[cfg(all(test, windows))]
    pub(super) metrics: super::diagnostics::SendMetrics,
}

impl Channel {
    pub async fn bind(peer: &Arc<Peer>, spec: ChannelSpec, rtc: Arc<RTCDataChannel>) -> Arc<Self> {
        let (high, low) = watermarks(&spec.label);
        let channel = Arc::new(Self {
            spec,
            rtc,
            outgoing: Mutex::new(()),
            writable: Notify::new(),
            high_water: AtomicUsize::new(high),
            #[cfg(all(test, windows))]
            metrics: super::diagnostics::SendMetrics::default(),
        });
        channel.rtc.set_buffered_amount_low_threshold(low).await;
        let weak = Arc::downgrade(&channel);
        channel
            .rtc
            .on_buffered_amount_low(Box::new(move || {
                let weak = weak.clone();
                Box::pin(async move {
                    if let Some(channel) = weak.upgrade() {
                        channel.writable.notify_one();
                    }
                })
            }))
            .await;
        Self::bind_state(peer, &channel);
        Self::bind_messages(peer, &channel);
        channel
    }

    fn bind_state(peer: &Arc<Peer>, channel: &Arc<Self>) {
        let weak = Arc::downgrade(peer);
        let key = channel.spec.key.clone();
        channel.rtc.on_open(Box::new(move || {
            Box::pin(async move {
                if let Some(peer) = weak.upgrade() {
                    peer.emit(Event::Open { key });
                }
            })
        }));
        let weak = Arc::downgrade(peer);
        let current = Arc::downgrade(channel);
        channel.rtc.on_close(Box::new(move || {
            let (weak, current) = (weak.clone(), current.clone());
            Box::pin(async move {
                if let Some(channel) = current.upgrade() {
                    channel.writable.notify_waiters();
                    if let Some(peer) = weak.upgrade() {
                        peer.emit(Event::Close {
                            key: channel.spec.key.clone(),
                        });
                    }
                }
            })
        }));
    }

    fn bind_messages(peer: &Arc<Peer>, channel: &Arc<Self>) {
        let weak = Arc::downgrade(peer);
        let key = channel.spec.key.clone();
        let native_stream = channel.spec.label == "remote-ai-sync-v1";
        channel.rtc.on_message(Box::new(move |message| {
            let (weak, key) = (weak.clone(), key.clone());
            Box::pin(async move {
                let Some(peer) = weak.upgrade() else {
                    return;
                };
                if message.data.len() > MAX_MESSAGE_BYTES {
                    peer.stop();
                    return;
                }
                if native_stream {
                    if !message.is_string {
                        peer.streams.receive(message.data).await;
                    }
                    return;
                }
                if message.is_string {
                    match std::str::from_utf8(&message.data) {
                        Ok(text) => peer.emit(Event::Text {
                            key,
                            text: text.into(),
                        }),
                        Err(_) => peer.stop(),
                    }
                } else {
                    peer.push_binary(BinaryPacket {
                        header: BinaryHeader::Data { key },
                        bytes: message.data,
                    })
                    .await;
                }
            })
        }));
    }

    pub async fn send(&self, bytes: Bytes, text: bool) -> Result<()> {
        self.send_checked(bytes, text, None).await
    }

    pub(super) async fn send_file(&self, bytes: Bytes, cancelled: &AtomicBool) -> Result<()> {
        self.send_checked(bytes, false, Some(cancelled)).await
    }

    async fn send_checked(
        &self,
        bytes: Bytes,
        text: bool,
        cancelled: Option<&AtomicBool>,
    ) -> Result<()> {
        if bytes.len() > MAX_MESSAGE_BYTES {
            return Err(Error::Capacity);
        }
        #[cfg(all(test, windows))]
        let locking = std::time::Instant::now();
        let _serial = self.outgoing.lock().await;
        #[cfg(all(test, windows))]
        self.metrics.lock(locking.elapsed());
        let send = async {
            loop {
                let available = self.writable.notified();
                if self.rtc.ready_state() != RTCDataChannelState::Open
                    || cancelled.is_some_and(|flag| flag.load(Ordering::Acquire))
                {
                    return Err(Error::Closed);
                }
                if self.rtc.buffered_amount().await + bytes.len()
                    <= self.high_water.load(Ordering::Relaxed)
                {
                    break;
                }
                #[cfg(all(test, windows))]
                let waiting = std::time::Instant::now();
                if cancelled.is_some() {
                    // Cancellation also releases a file send when the peer stops acknowledging bytes.
                    tokio::select! {
                        _ = available => {},
                        _ = tokio::time::sleep(Duration::from_millis(100)) => {},
                    }
                } else {
                    available.await;
                }
                #[cfg(all(test, windows))]
                self.metrics.wait(waiting.elapsed());
            }
            #[cfg(all(test, windows))]
            let sending = std::time::Instant::now();
            if text {
                let text = std::str::from_utf8(&bytes).map_err(|_| Error::Invalid)?;
                self.rtc
                    .send_text(text)
                    .await
                    .map_err(|_| Error::Transport)?;
            } else {
                self.rtc.send(&bytes).await.map_err(|_| Error::Transport)?;
            }
            #[cfg(all(test, windows))]
            self.metrics.sent(bytes.len(), sending.elapsed());
            Ok(())
        };
        tokio::time::timeout(Duration::from_secs(30), send)
            .await
            .map_err(|_| Error::Closed)?
    }

    #[cfg(test)]
    pub(super) async fn test_watermarks(&self, high: usize, low: usize) {
        assert!((MAX_MESSAGE_BYTES..=4 * 1024 * 1024).contains(&high) && low < high);
        self.high_water.store(high, Ordering::Relaxed);
        self.rtc.set_buffered_amount_low_threshold(low).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sustained_windows_refill_before_draining_and_keep_remote_controls_bounded() {
        for label in ["remote-ai-file-v1", "remote-ai-sync-v1"] {
            let (high, low) = watermarks(label);
            assert_eq!((high, low), (1024 * 1024, 768 * 1024));
            assert!(high - low >= MAX_MESSAGE_BYTES);
        }
        let (high, low) = watermarks("codex-chat-v1");
        assert_eq!((high, low), (512 * 1024, 384 * 1024));
        assert!(low < high && high - low >= MAX_MESSAGE_BYTES);
        for label in ["remote-desktop-controls", "remote-desktop-clipboard"] {
            assert_eq!(watermarks(label), (256 * 1024, 64 * 1024));
        }
    }
}
