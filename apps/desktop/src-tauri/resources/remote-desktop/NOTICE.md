# Desktop video runtime

Windows native streaming uses a separate LGPL shared FFmpeg build. The `desktop-video.exe` capture
helper dynamically links its replaceable FFmpeg DLLs; the Rust application does not link FFmpeg.
The runtime is prepared by `scripts/prepare-remote-desktop-runtime.mjs` and its
archive is verified with SHA-256 before extraction. The binary and shared libraries retain their
original licenses; `runtime/LICENSE.txt` accompanies packaged installations.

- Build: BtbN `autobuild-2026-08-31-13-27`, FFmpeg `n8.1.2-50-g1a748fe2cd`, Windows x64 LGPL shared.
- [Build scripts and dependency source references](https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-08-31-13-27)
- [Corresponding FFmpeg source](https://github.com/FFmpeg/FFmpeg/tree/1a748fe2cd)
- [Build archive and checksums](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-08-31-13-27)

`runtime/` contains generated third-party artifacts and is excluded from Git. Release builders
must run the preparation script before packaging. Unsupported hosts retain the existing capture path.

The helper's source is in `apps/desktop/src-tauri/desktop-video` under the repository's Apache-2.0
license. Rebuild it with the preparation script using Visual Studio 2022 C++, CMake and Windows SDK
10.0.26100.0. Headers/import libraries come from the same verified FFmpeg archive as the runtime DLLs.
No third-party implementation source is copied into the helper. The original FFmpeg executable remains
available as a compatibility fallback. The helper uses a static MSVC runtime; no separate VC runtime
installation is required. `scripts/test-desktop-damage.mjs` runs the opt-in interactive video comparison.

## Optional privacy display

`desktop-privacy` is a separate helper, launched only by an explicit privacy-screen request.
`scripts/prepare-desktop-privacy.mjs` builds it and verifies the pinned Windows driver archive.
It does not install drivers or change displays at build time.

- Windows: [VirtualDrivers/Virtual-Display-Driver 25.7.23](https://github.com/VirtualDrivers/Virtual-Display-Driver/tree/25.7.23),
  MIT. SHA-256: `e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a`.
  Original signed DLL, CAT and INF are distributed unmodified in `runtime/privacy-driver`, with its MIT license.
  Despite the archive name, this driver is for Windows x64. No UU components are used.
- macOS: private virtual-display declarations from [Stengo/DeskPad](https://github.com/Stengo/DeskPad), MIT.
  The original header and license are in `desktop-privacy/CGVirtualDisplayPrivate.h` and `LICENSE-DeskPad`;
  the license is also included in the runtime. Display management and recovery are our own implementation.

The driver DLL/catalog are checked with Windows Authenticode before installation. Installation remains
subject to Windows driver-signing policy; the application does not import certificates, enable test signing,
or change Secure Boot. macOS private API availability is checked before creating a virtual display.
