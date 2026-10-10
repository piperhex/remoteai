# Mac permission requests during remote desktop startup

Opening an authenticated remote desktop now requests a missing macOS grant on the host.
Screen Recording is requested first; Accessibility is requested only when remote control is enabled.
Automatic requests are limited to once per permission per application run, including concurrent retries.
The existing local **Remote settings → Mac access permissions** buttons can still request access explicitly.
macOS owns consent and may require the user to enable the grant in System Settings or restart Remote AI.

Only capture startup requests access. Status polling and input permission checks remain read-only.
Disabled remote desktop, invalid display requests and expired grants are rejected before requesting access.
The system request runs on a blocking worker without delaying the opening RPC or holding a capture/settings lock.
Permission refusals do not attempt the compatibility capture fallback.

Native Android/iOS and Web share the permission-wait behavior. They display the missing permission,
replace the reconnect button with **Check permissions**, and poll the authenticated host every three seconds
without opening capture. Checks are single-flight and pause when signaling goes offline. Closing the viewer,
switching hosts or retrying cancels the old wait and ignores late results. When the required permission changes
or all grants are available, the viewer starts one new connection. A view-only host does not require Accessibility.

The read-only `remoteDesktop / permissions` RPC is available only to a registered, unexpired peer.
Old hosts without that action keep the existing permission instructions and manual reconnect option.
Deploying only the server cannot add host prompts: install an updated Mac client and update the viewing client.

Regression coverage includes prompt deduplication, host authentication and policy, permission sequencing,
slow/late checks, disconnects, older hosts, cancellation, native iOS/Android copy and Web narrow/wide layouts.
A real logged-in Mac is required to verify the OS dialog and restart behavior; Windows tests cannot validate TCC UI.

## Repair after an app update or rename

Mac access permissions offers a separate repair action for Screen Recording and Accessibility, even when
the system reports the permission as enabled. Local confirmation explains that the chosen grant will be
cleared and must be enabled again. The host runs `/usr/bin/tccutil reset ScreenCapture dev.codex.switch`
or the corresponding `Accessibility` reset, then requests consent and opens System Settings.
The app never resets permissions on installation, startup, polling, or a remote request. The repair command
is restricted to the main desktop window and accepts only the two permission enum values.

A successful reset is remembered for the rest of the host process. The selected permission remains unavailable
to capture and input checks until restart, because macOS preflight APIs may still return a cached grant.
The settings page asks the user to reauthorize, save their work, and explicitly restart the app. Repeated
repair calls in that process reopen Settings without clearing newly granted consent. If opening Settings
fails after a successful reset, the UI preserves restart guidance and asks the user to open Settings manually.

For manual verification on a logged-in Mac, install an older build, grant both permissions, then update
or install the renamed app. Try remote viewing and control. Repair only Screen Recording, confirm that
Accessibility is not reset, reauthorize the current app and restart. Repeat for Accessibility and check
that view-only access still works without that permission. Also verify cancel, closing/reopening settings,
and Web narrow/wide and native clients waiting during repair. Remove obsolete entries in System Settings
and add the current app if the old name persists. Automatic updates preserve the existing app bundle path;
manual DMG installation can leave a separately named older app in Applications.

The current release uses ad-hoc signing. Repair is a recovery path; consistent Developer ID signing is
still needed to improve permission continuity between builds. Updater artifact signing is separate from
Apple code signing and does not provide a stable macOS privacy identity.

Native and Web viewers also show the Mac repair instructions when first-frame capture or capture startup
timeouts persist after automatic retries, including when the preflight permission check reports access.
