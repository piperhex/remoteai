# Native desktop receiver: large frames and 144 FPS

## Regression and correction

Commit `b365c9c20` (2026-11-17) moved the desktop viewer's WebRTC transport into Rust.
Its `SampleBuilder::new(64, ...)` limited the entire pending RTP frame to 64 packets,
not just reordered packets. With an approximately 1200-byte MTU, desktop keyframes larger
than roughly 75 KiB lost their initial packets before the frame's final packet arrived.
Small delta frames still contributed received bytes, but the decoder continued waiting
for a usable keyframe. This explains a low-resolution picture working while a 2560x1440
picture stays black with nonzero traffic and zero decoded FPS.

The receiver now allows 4096 buffered packets. This accommodates the existing 4 MiB
media limit at the sender's MTU. The 100 ms RTP reorder deadline and existing byte limits
remain in place. Capture, encoding, negotiated codecs, relay routing, frame-rate settings
and the wire format are unchanged.

The change is in the desktop receiver shared by local and remote application entry points.
Standalone Web continues using its browser RTC implementation. The affected PC is the
controller receiving the picture; updating the controlled PC alone does not replace this code.
No cloud service update is needed.

## Verification

- Before the correction, production H.264 and HEVC packetization of a 256 KiB keyframe
  produced zero assembled frames. The isolated running WebView2 viewer also reproduced
  the black loading screen at 2560x1440.
- Rust regressions now reconstruct those frames byte-for-byte, including reordered packets
  and sequence-number wrap. A missing-packet test verifies expiry followed by keyframe recovery.
- Windows WebView2 plays both H.264 and HEVC at 2560x1440. The original large-packet test
  uses unconstrained 30 FPS pattern frames so a small fixture cannot hide the regression.
- A separate 2560x1440, 144 FPS fixture uses the application's original-quality 12 Mbps
  bitrate. Over a five-second steady interval, H.264 decoded at 144.01 FPS and presented
  at 143.41 FPS; HEVC decoded and presented at 144.01 FPS. Audio, the real Rust RTC data
  channel, and the absence of browser RTC calls also passed.
- The synthetic sender originally used Tokio's interval with skipped late ticks. On this
  Windows host it supplied only about 90-98 FPS. Independent sender counters exposed that
  test limitation. The fixture now uses a dedicated blocking worker and a monotonic paced
  clock, without blocking the UI/runtime, changing system timer settings, or busy-spinning.
  Sender counters confirm approximately 144 FPS. The production capture helper already
  has its own high-resolution clock.
- Desktop adapter/remote-desktop suites passed 344 tests. Web desktop regression passed
  seven first-frame, resolution-change and reconnect tests, including its desktop-client
  presentation. Desktop production build and Rust Clippy passed during validation.

These are local loopback media tests using the actual native transport, IPC adapter,
WebCodecs decoder, shared viewer and audio path. They do not measure the user's two-PC
UDP relay or certify 144 FPS on every network/GPU. The installed controller still needs
the corrected MSI before that exact connection can be retested. The application supports
manual rates through 144 FPS; automatic mode starts at its existing 60 FPS setting.

Local evidence (not committed):

- `.codex-tmp/native-rtc/2560x1440/failure.png`: Windows local viewer, original receiver,
  large-frame loading failure.
- `.codex-tmp/native-rtc/2560x1440/windows-local-h264-playing.png` and
  `windows-local-h265-playing.png`: Windows local viewer, corrected receiver, 30 FPS stress source.
- `.codex-tmp/native-rtc/2560x1440-144fps/windows-local-h264-playing.png` and
  `windows-local-h265-playing.png`: Windows local viewer, corrected receiver, 144 FPS source.
- The same directories contain `report.json`; the 144 FPS directory also contains
  `native.log` with independently measured sender cadence.

## Repeating the media checks

From the parent workspace, compile the desktop Rust test target using the normal test
environment, then run Vite from `apps/desktop` with
`npx vite --config scripts/vite.native-rtc.config.ts --host 127.0.0.1`.
The harness has an isolated application identity and never launches full application startup.

```powershell
node apps/desktop/scripts/create-native-rtc-fixtures.mjs .codex-tmp/native-rtc-fixtures-1440p 2560x1440
$env:NATIVE_RTC_FIXTURES = (Resolve-Path .codex-tmp/native-rtc-fixtures-1440p).Path
node apps/desktop/scripts/test-native-rtc.mjs <test-executable> 2560x1440

node apps/desktop/scripts/create-native-rtc-fixtures.mjs .codex-tmp/native-rtc-fixtures-144fps 2560x1440 144 12000000
$env:NATIVE_RTC_FIXTURES = (Resolve-Path .codex-tmp/native-rtc-fixtures-144fps).Path
node apps/desktop/scripts/test-native-rtc.mjs <test-executable> 2560x1440 144
```

The optional generator arguments are size, FPS, and bitrate. Omitting them preserves the
original 640x360/30 FPS fixture and report paths. Use 640x480 for the user's low-resolution
comparison. Reports include both decoded and presented cadence; the runner rejects a
steady decode rate below 90% of the requested input rate instead of merely waiting for
an eventual frame count. Keep fixture size/FPS and runner arguments identical.
