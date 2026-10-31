# Mobile lounge verification

The production native and mobile Web entry is Discover → Online Chat. Native uses the shared
controller with an AppState lifecycle adapter and Expo image handling. Account avatars are saved on
the server and synchronized across devices; received messages stay local. SQLite history survives restart
and supports paged search. The
connection stays mounted while navigating other pages. Mobile operating systems may suspend
the app in the background; returning resumes or reconnects without downloading missed messages.
The lounge does not request notifications or send system alerts.

## Mobile layout

The chat header combines back navigation, the conversation title, member status and the Chats entry.
Manual dragging and momentum take priority over automatic scrolling. Leaving the bottom preserves
the reading position even within the read-receipt proximity threshold; reaching the bottom or using
the latest-message shortcut resumes following. Native and mobile Web retain that position on reopening.
Private chat accounts stay on one line with an ellipsis for overflow; presence is shown underneath.
Chats opens a full-page searchable list with local message previews, drafts and unread badges; opening
the list does not mark other conversations as read. Text, image attachments, quoted replies and scroll
positions are retained when switching conversations within the page. The compact composer grows with
multiline input; its add-content sheet contains images, history, avatar settings and blocking.

The member sheet lists locally known participants, including people encountered in group messages.
Only authorized moderators receive the server's total online count. Other users see Members, and unknown
or hidden contact presence is never inferred. The information sheet distinguishes group offline behavior
from direct-message retry behavior. Light and dark themes follow the app preference.

## Physical Android

The isolated `com.codexswitch.mobile.loungetest` application renders the production discovery,
navigation, lounge, composer, history and moderation components against a local WebSocket fixture.
It does not use the installed application's credentials or modify a real chat room.

```powershell
$env:NODE_PATH = (Resolve-Path apps/native/node_modules).Path
$env:NODE_ENV = 'production'
$env:ANDROID_SERIAL = '<physical device serial from adb devices>'
Push-Location apps/native/android
.\gradlew.bat assembleRelease -I ../e2e/lounge.init.gradle -PreactNativeArchitectures=arm64-v8a
Pop-Location
node apps/native/e2e/lounge-test.mjs
```

Set `LOUNGE_AVATAR_ONLY=1` to run the focused avatar checks using the same fixture and font scales.
They cover server save failures, successful saves, external profile updates, resets, fresh installs,
reconnection with stale caches, and the translated settings copy. Server tests separately validate
48×48 PNG uploads, metadata stripping, PostgreSQL persistence and account isolation.

Set `LOUNGE_CONTACTS_ONLY=1` to verify cloud contact restoration with empty local data, live contact additions,
opening private chats and back navigation at font scales 1.0 and 1.3. The fixture never downloads chat content.
Inspect the `cloud-contacts-*.png` screenshots. The shared sync also runs in desktop local/remote and Web tests
in `apps/desktop/e2e/lounge-contact-sync.pw.ts`; PostgreSQL tests cover mutual-message eligibility and deletion.

Set `LOUNGE_NEW_CHAT_ONLY=1` to verify the New chat sheet, recent speaker selection, exact email/local-part
lookup, ambiguous/missing/self results, keyboard layout, cancellation, retained drafts, translations and
back navigation at font scales 1.0 and 1.3. Inspect the `new-chat-*.png` captures for complete Chinese glyphs.
The mobile Web counterpart is `apps/desktop/e2e/lounge-new-chat-mobile.pw.ts` at 320px and 390px.

Set `LOUNGE_ORDERING_ONLY=1` to verify private chat ordering by last message, pin/unpin actions,
multiple pinned chats, offline restart, translation and navigation at font scales 1.0 and 1.3.
Inspect `ordering-*.png` for menu text, pin indicators and complete Chinese glyphs. The browser counterpart
is `apps/desktop/e2e/lounge-ordering.pw.ts`, including desktop local/remote/Web and 320px/390px mobile Web.

Set `LOUNGE_CHAT_ACTIONS_ONLY=1` to inspect the private chat action sheet, long account wrapping,
pin/unpin, block/delete confirmations, dismissal and navigation at font scales 1.0 and 1.3.
Inspect `chat-actions-*.png` for complete glyphs and light/dark appearance. The mobile Web counterpart
is `apps/desktop/e2e/lounge-chat-actions.pw.ts`, covering right-click and long-press at 320px and 390px.

Set `LOUNGE_NOTIFICATIONS_ONLY=1` to verify group/private notification settings, failed saves, live updates,
restart restoration, entry badge filtering and avatar unread badges at font scales 1.0 and 1.3.
Inspect `notifications-*.png` for complete glyphs and the top-right `99+` badge. Browser coverage is in
`apps/desktop/e2e/lounge-notifications.pw.ts`, including desktop local/remote, Web and mobile Web.

Set `LOUNGE_PREVIEW_ONLY=1` to check the chat list without selected rows, the latest incoming unread
text, single-line truncation, retained previews after reading, outgoing replies and back navigation
at font scales 1.0 and 1.3. Inspect `preview-*.png` in `.codex-tmp/lounge-android/` for glyphs and truncation.

Set `LOUNGE_TEXT_ONLY=1` to check `hi`, short Chinese messages, longer words, explicit newlines,
wrapped Chinese messages and back navigation at font scales 1.0 and 1.3. Inspect the screenshots in
`.codex-tmp/lounge-text-<device serial>/` for complete glyphs; positive accessibility bounds alone
do not establish that text is unclipped. `LOUNGE_TEST_APK` can select an isolated fixture APK when
another build is using the default Android output directory. The mobile Web regression is
`apps/desktop/e2e/lounge-text.pw.ts`, using the production Web entry at 320px and 390px.

Set `LOUNGE_PRIVATE_SCROLL_ONLY=1` to verify small downward drags, stable message positions, reopening,
longer history swipes and the latest-message shortcut with mixed-height image messages and read receipts.
The physical Android runner covers font scales 1.0 and 1.3; inspect `private-idle-*`, `private-reopened-*`,
`private-history-*` and `private-latest-*`. Set `LOUNGE_TEST_OUTPUT` to choose a separate capture directory.
Mobile Web regressions in `apps/desktop/e2e/lounge-mobile-scroll.pw.ts` cover 320px and 390px layouts,
incoming messages while reading near the bottom, restoration and resuming automatic following.

Set `LOUNGE_IMAGE_ONLY=1` to verify image previews with real two-finger pinch gestures, single-finger
panning, back navigation and previews above history at both font scales. The gesture runner compares
image pixels before and after each gesture and checks that the preview stays open. It requires
`ANDROID_HOME` and a JDK, and stores screenshots alongside the other lounge captures.

The runner verifies discovery unread badges, sending, search, mute actions, foreground delivery,
long-press quote replies, cancellation, locally restored quotes, moderator-only presence,
private messages, contact lists, one-way blocking, hidden presence and offline private history,
language changes and session cleanup at system font scales 1.0 and 1.3. It also restarts the app
with the ticket endpoint unavailable and searches a uniquely sent message, proving local persistence
without server replay or historical unread counts. It restores the previous
font scale and opens the installed app afterward. Inspect `.codex-tmp/lounge-android/*.png` for
complete Chinese glyphs, entry/back navigation, keyboard layout and wrapping. iOS needs separate
device verification; this Android fixture is not evidence of iOS execution or background delivery
while the operating system has suspended networking.

## Automated checks

Lounge account labels contain only the email local part. The Go API strips domains from tickets,
account objects and reply metadata; message text, nicknames and private remarks are not altered.
Exact full-email lookup remains supported, and private delivery and chat assistance use user IDs.
Local history stays scoped to the signed-in account rather than its potentially shared display prefix.

Set `LOUNGE_PRIVACY_ONLY=1` to inspect prefix labels, legacy quotes, profile pages and back navigation
on physical Android at font scales 1.0 and 1.3. The corresponding browser regression is
`apps/desktop/e2e/lounge-account-privacy.pw.ts` across desktop local/remote, Web and mobile Web.
API coverage is in `internal/lounge/account_privacy_test.go` and
`internal/devices/assistance_account_integration_test.go` in admin-go.

Set `LOUNGE_ADMIN_BADGE_ONLY=1` to verify the yellow administrator badge before sender names,
ordinary messages without badges, own messages, history, English copy and back navigation at
font scales 1.0 and 1.3. Inspect `admin-*.png` for complete glyphs, long nickname wrapping and
light/dark appearance. Browser coverage is in `apps/desktop/e2e/lounge-admin-badge.pw.ts`.

Set `LOUNGE_NAMES_ONLY=1` to verify nickname and owner-private contact remarks saved on blur, failed-save retries,
and saving before back navigation (keeping the profile open when saving fails),
remote-device updates, clearing, long-press sheet labels and server recovery after clearing app data.
The fixture runs at font scales 1.0 and 1.3; inspect `names-*.png` for Chinese glyphs and keyboard layout.
`apps/desktop/e2e/lounge-names.pw.ts` covers desktop local/remote/Web and 320px/390px mobile Web.
Actual PostgreSQL persistence, authenticated ownership and remark privacy are verified separately by
`go -C apps/admin-go test ./internal/lounge -run TestLoungeNames` with `LOUNGE_TEST_DATABASE_URL` set.

```powershell
npm run check -w @codex-switch/native
npx vitest run --root apps/native src/lounge
npm run check:i18n
Push-Location apps/desktop
npx playwright test --config playwright.lounge.config.ts
Pop-Location
```

The browser suite uses bundled Chromium and includes 320px/390px mobile Web discovery, multiline
input, mixed messages, history, moderation and a reduced viewport for keyboard layout. It also
regresses desktop local/remote/Web chat because the controller and browser composer are shared.
`playwright.lounge-compat.config.ts` also checks repeated emoji opening, caret insertion,
keyboard dismissal and touch selection in bundled Chromium and WebKit. This does not replace
testing the reported macOS Chrome version on macOS hardware.
Native unit tests cover image byte limits, temporary image cleanup, 48px avatar crops, picker
cancellation, lifecycle behavior without DOM globals, and SQLite restart/account isolation, literal
search, pagination beyond 200 messages and image-heavy page bounds. Server deployment remains separate and
follows `apps/admin-go/DEPLOYMENT.md`.
