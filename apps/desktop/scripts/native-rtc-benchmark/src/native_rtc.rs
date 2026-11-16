// Tests deliberately compile the owning application's sources rather than maintain a second transport.
#[path = "../../../src-tauri/src/native_rtc/benchmark.rs"]
mod benchmark;
#[path = "../../../src-tauri/src/native_rtc/channel.rs"]
#[expect(
    dead_code,
    reason = "Raw transport diagnostics do not send encrypted application files"
)]
mod channel;
#[path = "../../../src-tauri/src/native_rtc/events.rs"]
mod events;
#[path = "../../../src-tauri/src/native_rtc/hevc.rs"]
mod hevc;
#[path = "../../../src-tauri/src/native_rtc/media.rs"]
mod media;
#[path = "../../../src-tauri/src/native_rtc/model.rs"]
#[expect(
    dead_code,
    reason = "The sender-only target does not instantiate application IPC DTOs or peer slots"
)]
mod model;
#[path = "../../../src-tauri/src/native_rtc/peer.rs"]
#[expect(
    dead_code,
    reason = "The full application tests IPC dispatch and receive APIs; this target measures sending"
)]
mod peer;
#[path = "../../../src-tauri/src/native_rtc/turn_transport.rs"]
mod turn_transport;

// The fast transport target has no file services; full pipeline runs use the application's test executable.
mod encrypted_benchmark {
    pub(super) async fn samples(
        _: &super::peer::Peer,
        _: &super::channel::Channel,
        _: &serde_json::Value,
    ) -> Vec<serde_json::Value> {
        panic!("Encrypted pipeline benchmarks require the full desktop test target")
    }
}
