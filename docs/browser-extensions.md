# Built-in browser extensions

The Windows browser uses WebView2's extension-enabled profile. The application WebView retains a separate
profile and does not enable extensions. The toolbar menu lists installed extensions, their manifest icons
and enabled state, with pinning and management controls. The manager imports installed Chrome extensions
from Default/Profile directories. Installation reuses the shared file explorer to select unpacked folders,
manifest.json, ZIP or CRX files. The same surface accepts dragged files and complete folders.
Chrome's original files and settings are not changed.

Installation copies the extension into an immutable application-owned directory before calling
AddBrowserExtension. Chrome upgrades and changes to the original unpacked folder do not invalidate the copy.
Reimport keyed extensions to update them. Unpacked extensions without a manifest key may receive a new ID;
remove their previous copy when replacing them. Symlinks/reparse points, escaping resource paths, excessive
file counts and oversized packages are rejected. Chrome's reserved _metadata directory is excluded.
The engine owns installation/enabled state; a small atomic catalog owns presentation metadata and pins.
Operations are serialized on a worker,
with COM access confined to the WebView's apartment. Timed-out mutations are not automatically replayed.

Remote file browsing uses the connected computer's existing project-directory transport. Native remote drops
export a bounded local snapshot before uploading it; browser drops preserve folder-relative names and upload
file contents in 192 KiB chunks. Paths from the viewer are never interpreted on the connected host. Transfers
are capped at 256 MiB and 20,000 entries, require exact offsets and complete files, and are released after
success, cancellation or failure. Archive extraction rejects traversal, symlinks and duplicate files.
CRX packages are unpacked as user-provided extensions; this does not verify a Chrome Web Store signature.

The manager uses theme tokens, a drop/browse area, a built-in assistant summary, searchable extension rows,
compact enable/pin/remove controls, and expandable permission details rather than long permission lists.

Toolbar icons prefer action.default_icon (including a single string or size map), falling back to icons.
Missing preferred sizes fall back to other available sizes. PNG, JPEG, GIF, WebP, ICO and BMP bytes are returned
as bounded data URLs. SVG/HTML from an extension is never embedded in the privileged host document. The built-in
Remote AI assistant uses the same packaged brand icon as the Chrome assistant.

The Remote AI assistant is integrated through the existing native page/snapshot/input/screenshot tools and
requires no extension installation. The Chrome skill and MCP descriptions continue to prefer Chrome, then
the built-in browser when Chrome is unavailable or explicitly requested. Extension management is a user UI
operation and is rejected by the model's gui_browser_use entry point.

## Host behavior and compatibility

- Local Windows desktop manages its own browser profile. Conversation-owned and ordinary browser tabs use
  that same browser profile, so content scripts apply to both.
- Connected desktop remote and Web conversation browsers use the selected computer's authenticated guiBrowser
  transport. Extension management, paths and Chrome discovery refer to that computer. Extension popup windows
  open on the connected computer, as explicitly labeled in the manager.
- Standalone browser-hosted iframe previews do not gain extensions. Without a connected host the UI reports
  the unavailable connection. macOS/Linux hosts report unsupported installation rather than pretending to load
  Chrome extensions into WebKit.
- WebView2 does not implement all Chrome extension UI/API integrations. Manifest popup pages open in a separate
  asynchronous native window. Extensions requiring Chrome-specific tab/action/side-panel behavior may not work
  completely. Native action-click events and dynamic action badges/icons are not emulated.
- Popup labels are registered with the local-only default capability. Their external chrome-extension origins
  are not granted application IPC capabilities. Navigation stays within the owning extension. Disabling or
  removing an extension also closes its popup.

## Verification

Run npm run check:i18n, npm run check:boundaries, npm run build:desktop, and the Web standalone check after
refreshing its dependency snapshot with npm run export:web -- --retain-tests. Browser tests use the guarded
bundled Chromium:

```powershell
cd apps/desktop
npx playwright test --config scripts/playwright.browser-extensions.config.ts
```

This suite covers local, remote and Web themes at 1440/default font and 960/enlarged font, import, unpacked
installation errors, the reused file explorer, drag/drop, pinning, toggles, unsupported hosts and offline
English resources. Screenshots are in .codex-tmp/browser-extensions-evidence.

For real Windows engine verification, compile the Rust lib tests and start Vite with
scripts/vite.browser-extensions.config.ts on port 1582. Set BROWSER_EXTENSION_TEST_EXE to the resulting
codex_switch_lib test executable, then run node scripts/verify-browser-extensions-native.mjs.
The runner starts/stops an isolated test application, installs a content-script extension, verifies visible
page changes and enabled/disabled state, tests icon rendering, reads Chrome candidates, and checks persistence
across an application restart. Remote and Web clients use a loopback bridge to the same actual native engine;
this verifies transport behavior without claiming a second physical computer was tested. Native drop callbacks
and browser file/directory entries are delivered through their respective event paths, covering ZIP/CRX,
folders and the local-export/remote-upload route against the real engine.
Results and screenshots are in .codex-tmp/browser-extensions-native.
