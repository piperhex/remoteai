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
requires no extension installation. Its toolbar button opens a docked chat panel with reload, open-in-browser
and settings controls. Switching between chat and settings retains the loaded page and draft. Extension management is a user UI
operation and is rejected by the model's gui_browser_use entry point.

The default browser order is Chrome assistant, AgentHub conversation sidebar, then the independent menu
browser. These are three distinct destinations. Browser settings and the assistant panel's settings button
both expose the same reorder controls. Changes apply to the host computer, including its connected desktop
and Web clients. Each new conversation turn receives the current order, and tools can read it again during
a turn. Explicit user choices override the order; availability, Chrome pause/site permissions and submission
safety rules continue to apply. Existing tabs retain their destination and owning computer.

## Host behavior and compatibility

- Local Windows desktop manages its own browser profile. Conversation-owned and ordinary browser tabs use
  that same browser profile, so content scripts apply to both.
- Connected desktop remote and Web conversation browsers use the selected computer's authenticated guiBrowser
  transport. Extension management, paths and Chrome discovery refer to that computer. Extension popup windows
  open on the connected computer, as explicitly labeled in the manager.
- Standalone browser-hosted iframe previews do not gain extensions. Without a connected host the UI reports
  the unavailable connection. macOS/Linux hosts report unsupported installation rather than pretending to load
  Chrome extensions into WebKit.
- Installed extensions declaring `side_panel.default_path` open their real extension-origin page in the docked
  panel. Popup-only extensions retain their separate asynchronous window. Local Windows panels use a native
  child WebView; connected desktop and Web panels display captures and forward bounded pointer, keyboard,
  text and scroll input to that same host. The extension profile remains separate from application pages.
- WebView2 does not implement all Chrome extension UI/API integrations. Dynamic `chrome.sidePanel` registration,
  action-click events and dynamic action badges/icons are not emulated. Declaring a side-panel page does not
  guarantee compatibility with other Chrome-only APIs used by that page.
- Popup labels are registered with the local-only default capability. Their external chrome-extension origins
  are not granted application IPC capabilities. Navigation stays within the owning extension. Disabling or
  removing an extension also closes its popup and side panels. Side-panel navigation stays on the chat origin
  or the owning extension origin, and does not receive application IPC capabilities.

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

With the same Vite server and Rust executable, run
`node apps/desktop/scripts/verify-browser-side-panel.mjs` from the parent root. It exercises actual side-panel
input, draft retention, preference persistence, separate destinations, extension origins and teardown across
local, remote and Web hosts, both browser entry points, light/default and dark/enlarged narrow layouts.
Remote transport uses the loopback bridge rather than a second physical computer. Evidence is saved under
`.codex-tmp/browser-side-panel`.

## Administrator marketplace

The admin console's Browser extensions page accepts ZIP and CRX packages through file selection or drag/drop.
Uploads extract the manifest name, description, version, raster icon and requested permissions. New packages
and replacements remain unpublished until an administrator publishes them. Unpublishing or deleting prevents
new downloads immediately; it does not remove installations from users' computers.

- `admin.browser-extensions.read` permits the management list; `admin.browser-extensions.manage` permits
  uploading, replacement, publishing and deletion. Changes and their audit record commit in one transaction.
- `GET /browser-extensions` exposes published metadata. Downloads use
  `/browser-extensions/:id/archive?sha256=<digest>` and require the current published digest.
  Packages are attachment downloads, never executable pages on the admin origin.
- Archives are bounded to 64 MiB compressed, 256 MiB expanded and 20,000 entries. Validation rejects traversal,
  Windows reserved paths, case-insensitive duplicates, links, invalid manifests, oversized entries and CRC failures.
  CRX is treated as a ZIP container; its signature is not an approval or trust signal.
- The desktop and Web marketplace use the configured account server. After permission confirmation, downloads
  are SHA-256 checked and sent through the existing browser transfer to the selected computer. The host checks
  the digest again and persists marketplace identity. Installing a replacement removes the prior market copy
  while retaining its toolbar pin. Installing the same package again is disabled in the UI.
- Desktop local and remote modes fetch public catalogs and archives through the viewing host's asynchronous
  native command; hosted desktop pages use the same command through their authenticated local backend.
  Standalone Web pages use browser fetch. Do not fetch directly from the desktop WebView: the packaged CSP
  intentionally excludes arbitrary cloud servers. Both transports retain bounded reads and archive checksums;
  the native command permits only the marketplace paths and never forwards credentials or follows redirects.
- Existing deployments with schema synchronization disabled must apply
  `apps/admin/sql/20261115-browser-extensions.sql`. The Kong example includes the public route; all management
  routes remain under the authenticated `/admin/api` prefix. Deploying these changes is a separate operation.

The Go package has archive, permission, lifecycle and transactional persistence tests. To include PostgreSQL
tests, set `BROWSER_EXTENSIONS_TEST_DATABASE_URL` to an isolated database before running
`go test ./internal/browserextensions` in `apps/admin`.

The full UI/engine verification uses an isolated loopback database named `extensions_test`, with the Go fixture
`go run ./scripts/browser-extension-fixture` on port 1592. Start the admin UI on 1593 and the desktop harness on
1582, then set `BROWSER_EXTENSION_TEST_EXE` and run
`node apps/desktop/scripts/verify-browser-extension-market.mjs` from the parent root. The fixture and runner
are only for local verification. They cover upload, publication, real engine installation and content scripts,
replacement, restart persistence, unpublishing, deletion, permissions, icons, and local/remote/Web screenshots.
Remote and Web transport checks use the same real engine over loopback. Evidence is saved under
`.codex-tmp/browser-extension-market-evidence`.

For the packaged network-policy regression, use the same Vite harness and freshly compiled Rust executable
with `node apps/desktop/scripts/verify-browser-extension-market-network.mjs`. It checks native catalog and
archive requests while WebView fetch is blocked by the production `connect-src`, plus empty lists, failures,
retry, and local/remote/Web browser entry points. It also reads the public production catalog without changes.
Screenshots and results are saved under `.codex-tmp/browser-extension-market-network`.
