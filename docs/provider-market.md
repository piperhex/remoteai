# Provider market

The market stores public connection definitions independently of personal Providers. Browsing,
publishing, editing, sorting and withdrawing entries never insert or update personal configurations.
Adding is an explicit action that creates a new ID through the existing Provider save path. It does
not activate the Provider. Prices are reference information and do not modify proxy billing or routing.

## Server upgrade

This feature requires an updated **admin-go** server, admin UI and desktop clients. No production
deployment is part of this change. Existing databases must apply
`apps/admin/sql/20261029_provider_market.sql` before the new server is started. It adds the market
tables and the optional `synced_providers.balanceScript` column. New databases use embedded migration
026. Keep the complete production Compose stack, including desktop relay services, and follow
`apps/admin/DEPLOYMENT.md` for a later deployment.

Update Kong with the additional routes in `apps/admin/kong/existing-kong.example.yml`, preserving
all existing routes. Public GETs are anonymous; publishing, own entries and usage recording require
authentication. The Go handlers enforce authentication and ownership even if reached without Kong.
Old servers display an unavailable/update message in clients.

Five independent admin permissions are added by the runtime permission catalog:

- `admin.provider-market.read`: inspect all entries.
- `admin.provider-market.manage`: maintain platform-owned entries, including publication status.
- `admin.provider-market.order`: set or clear Provider entry priority.
- `admin.provider-market.review`: approve or reject community publications.
- `admin.provider-market.promote`: set or remove marketing badges on any market entry.

All mutation permissions depend on read permission. Community content editing is always restricted to the
authenticated publisher. Request bodies cannot supply ownership, official status, user counts or
ordering. Optimistic revisions prevent stale changes. “Maintained by Remote AI” means platform
maintenance, not model-vendor certification.

## Review and marketing badges

Apply `apps/admin/sql/20261102_provider_market_review.sql` before starting the updated Go service.
New databases use embedded migration 029. Existing community entries enter review and become hidden
from public browsing until an administrator approves them; existing official presets remain approved.
Reapplying the upgrade does not reset completed reviews. This task does not deploy production services.

Community publication requests enter `pending`. Any subsequent publisher write resets approval;
submitted edits and republishing require a new review, while withdrawal sets `draft`. The current entry
is hidden during review rather than retaining a separate live revision. The public list, detail and
usage endpoints require both `published` and `reviewStatus: approved`. The owner can inspect pending
or rejected entries under My publications, including the rejection reason. Successful submission opens
that scope and explains that publication awaits approval. Already installed personal Providers stay intact.

Admins filter entries by review status, inspect the full definition, and use
`PATCH /admin/api/provider-market/:id/review` with a revision, `approved` or `rejected` decision,
and a required reason for rejection. Approval is only valid for a pending, nonwithdrawn community
entry. Reviews record the reviewer and time. Concurrent publisher, order, badge and review writes
invalidate stale revisions, so a review cannot approve unseen edits. These routes use the existing
protected `/admin/api` Kong prefix and enforce their own permissions in Go.

`PATCH /admin/api/provider-market/:id/badge` accepts a revision and a nullable badge containing
up to 24 text characters and one of `blue`, `green`, `orange`, `red`, or `purple`. Badge changes do
not approve content. Cards render badges in the upper-right area beside the maintenance menu, with
wrapping for long text. Badge text is administrator content, never HTML or CSS. Publisher request
allowlists reject badges and review metadata; the local Rust and hosted transports retain server metadata.

## Public format and prices

The public DTO is an allowlist: name, description, service URL, currency, token unit, ordered models
and independent ordered price tiers, plus an optional balance parser definition. It is never derived
by serializing a Provider profile or a `.cs` backup. Public JSON downloads use
`remoteai.provider-market.v1`; importing one first opens a review and requires a new, private key.
URLs reject credentials, query strings, fragments and unrestricted custom paths. Publishers must
also exclude secrets from descriptions and parser source; arbitrary user text cannot be proven
secret-free automatically. No personal key or wallet credential is copied into a publication.

Each tier has its own multiplier, nullable input/output/cached-input prices, nullable long-context
threshold and nullable long-context prices. A supplied long-context price requires a threshold.
`null` means not provided; `0` means explicitly free. The unit is currency per million tokens.
No price is calculated by multiplying another tier. Model and tier arrays preserve publisher order.

## Provider website and browser

Publishing or republishing requires `pageLink.url`, an independent HTTP(S) website address. Unpublished
legacy entries may still omit it; republishing opens the editor to complete the address. Existing
entries remain readable. `pageLink.query` appends a query string without replacing existing parameters,
repeated values or the fragment. `pageLink.headers` is an optional object of custom HTTP headers.
These settings are public and must not contain personal credentials. Transport headers, cookies,
invalid header names, duplicate names ignoring case, control characters and oversized values are rejected.

Installation snapshots the entry ID and page configuration as `marketSource` in the personal Provider.
It survives local persistence, cloud synchronization, edits by older clients, and archive roundtrips.
It does not change API routing, upstream request options or API keys. Ordinary manual additions and
unattributed public JSON imports have no market provenance and no website action. Market entries
without a page cannot offer the action. The name and the “Visit page” action use the same browser,
including in the card layout. Future edits to a publication do not silently replace installed links.

The browser opens at 85vw × 85vh with independent tabs, address input, back/forward, reload, tab closing,
and full-viewport expansion. Closing the browser hides it and keeps its tabs until the Provider page
unmounts. Windows uses unprivileged child WebViews: the complete website loads normally, including
scripts, navigation and cookies. Custom headers are installed before the first request, apply only
to the configured origin, and are removed from cross-origin requests. Popup links create another tab.
Web content receives no application IPC capability. Native view creation and updates run in workers;
resize requests are coalesced and close waits for creation to finish.

Hosted browser pages use an iframe when no custom headers are configured. Website frame policies
still apply, and back/forward track addresses entered in the browser toolbar. Configurations with
headers show an explicit Windows desktop requirement instead of silently omitting headers. macOS/Linux
also report that limitation for custom headers. Remote account pickers and the standalone Web model
switcher do not contain a personal Provider table; their existing entry placement is preserved.

Deploy the upgraded Go server with `apps/admin/sql/20261030_provider_market_page.sql` before using
cloud synchronization of website settings. New databases apply embedded migration 027. This task does
not deploy production services or change Kong routes.

Browser checks use `playwright.provider-market.config.ts`. The optional real Windows WebView test is
`provider_browser::smoke::opens_provider_browser` (ignored by default); start the market Vite harness on
1499 and `node apps/desktop/e2e/provider-browser-server.mjs` first. It uses a separate app identifier
and `PROVIDER_BROWSER_DEBUG_PORT` for inspection. The fixture exposes received query strings and
headers on ports 1500/1501 to verify same-origin delivery and cross-origin removal.
With the smoke test running and its debug port set to 9319, run
`node apps/desktop/e2e/provider-browser-native.mjs` to verify real navigation, header delivery,
popup tabs, fullscreen controls, polling responsiveness and cleanup after a renderer reload.

## Adding and counting

Market cards open the add dialog from anywhere on the card. Publisher maintenance actions live in the
top-right ellipsis menu; deletion still requires confirmation. The add dialog uses the Provider name as
its title, places the private API key field first, and keeps the add action in the fixed bottom-right
footer while details scroll. Closing this dialog returns to the market; closing the market dismisses it.
The add dialog does not offer a copy-share-link action.
Both dialogs are centered at 85vw by 85vh. Content wraps inside a scrollable body with its scrollbar at
the dialog's right edge; headers and the add footer remain fixed. The add dialog omits the service URL
and page-access settings. Those settings remain part of publications and installed configurations.
The new-publication and editing forms keep Cancel and Publish in the same fixed bottom-right footer;
the form fields scroll independently, and Publish retains form validation and duplicate-submit protection.

Desktop local and hosted desktop pages save to the computer's existing personal Provider store.
Desktop remote workspaces and signed-in Web pages save to the existing personal cloud store; the
computer must sync before the Provider becomes available there. No remote activation is performed.
Anonymous browsing works everywhere. Anonymous standalone Web visitors can download public settings
without credentials, then import and add them on a computer; the Web service has no anonymous personal
cloud account to save to. Anonymous local additions require no account.

Usage is the historical number of distinct authenticated accounts that successfully added and
cloud-synced a matching personal Provider. The server checks a nondeleted owned `synced_providers`
row, URL, model and key presence before inserting a unique `(entry, account)` usage row. Clients
cannot submit a numeric increment. Repeated additions by one account count once. Anonymous and
unsynced local additions are excluded, so this is not a count of every installation. Failed usage
reporting never makes a successful installation fail or triggers another installation.

Nonempty manual sequence numbers sort first, ascending. Remaining ties use usage descending and a
stable creation/ID tie-breaker. Clearing the sequence restores default ranking. Only market Provider
entries are ordered; personal lists, model lists and tier lists are unaffected.

## Balance parsers

The opt-in parser contract is:

```js
function parseBalance(response) {
  return { amount: response.balance, currency: "USD" };
}
```

`balanceQuery` contains a URL, `auth` (`bearer`, `x-api-key`, or `none`) and source text. The installer
shows the URL and complete source; execution is disabled unless the user explicitly enables it.
The personal Provider editor can change or remove it. Old sync clients omitting this field cannot
erase an enabled parser; explicit clearing has its own field timestamp.

Go stores and validates definitions but never executes JavaScript. Rust runs a single bounded GET
to a same-origin HTTPS URL, with no redirects, query parameters, fragments, cookies or arbitrary
headers. The host can attach the user's own key using the chosen fixed auth header. The script sees
only response JSON, never host credentials. The query times out after 10 seconds and reads at most
1 MiB. System proxy configuration is respected.

`crates/provider-balance-script` creates a fresh QuickJS runtime for each synchronous parser call,
without network, process, filesystem, module-loader or host bindings. Limits are 16 KiB source,
8 MiB engine memory, 256 KiB stack and a 100 ms interrupt deadline. Promise jobs are not executed.
The result must contain only a finite amount and USD/CNY/EUR/JPY currency. Scripts cannot modify
connection routing, model selection, prices or the user's configuration. Desktop IPC and hosted
dispatch move blocking network/runtime work to workers; existing balance requests are single-flight.

## Verification

Run the Go marketplace integration tests against a dedicated PostgreSQL database using
`PROVIDER_MARKET_TEST_DSN`. They exercise real SQL ownership, permissions, conflicts, independent
prices and deduplicated saved usage. Other relevant suites are accounts, identity and server/Kong.
Rust tests cover the sandbox, DTOs and personal storage; run desktop Rust tests serially as described
in `scripts/check-desktop-rust.mjs`, plus Clippy and formatting.

`apps/desktop/playwright.provider-market.config.ts` uses bundled Chromium and the repository launch
helper, an isolated Vite cache and port 1499. It renders actual local, hosted, remote, Web and admin
components with controlled IPC/HTTP fixtures. It verifies entry placement/gradients, light and dark
layouts, optional prices, publishing, account switching and explicit adding. These browser tests do
not claim a live production server, an actual Tauri WebView or a real external balance endpoint.
