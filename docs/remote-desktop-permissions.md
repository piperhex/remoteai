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
