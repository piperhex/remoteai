# Concurrent conversation responsiveness

Opening concurrent conversations exposed two independent sources of continuous work in Windows 2.2.2:

- Chrome native messaging leases inherited a nonblocking listener socket. The 250 ms read timeout
  therefore returned immediately with `WouldBlock`, repeatedly reloading the authorization file.
  Two idle leases consumed approximately two logical CPU cores in the diagnostic session.
- Streaming paragraphs, processing labels and activity previews animated `background-position` on
  clipped text. DevTools reported unsupported compositor properties and repeated layer/paint work.

Accepted Chrome connections now explicitly use blocking I/O before reading any protocol frame.
This also lets a frame arrive in separate TCP reads. Authorization revocation, EOF handling and
the lease's existing 250 ms check interval remain in place.

Conversation text now stays static while content arrives. The small running icons, elapsed time,
streamed content and status labels still communicate progress. The shared remote/Web activity
styles follow the same rule. Reduced-motion and forced-colors users retain readable text.

The base branch already filters background conversation bodies at the native and client boundaries.
The regression coverage now sends 1,000 background deltas for each of six streaming event types
and checks that React is not notified, including after the frame batching timeout.

## Diagnostic evidence

These are measurements from the installed, unmodified 2.2.2 application with a temporary CSS animation
pause; they are not a benchmark of the newly built application. One logical core is 100%. The GPU
column measures the GPU process's CPU time, not GPU utilization.

| Animation state | Renderer CPU | GPU process CPU | Chrome bridge CPU |
| --- | ---: | ---: | ---: |
| Running | 43.4% | 44.0% | 100.2% |
| Temporarily paused | 8.6% | 1.3% | 99.8% |
| Restored | 47.1% | 46.1% | 97.9% |

The experiment pauses all CSS animations, so it does not attribute the complete reduction to one
effect. The bridge load is independent of animation state. A local Rust reproduction returned
`WouldBlock` after approximately 0.003 ms before resetting the accepted socket, and `TimedOut`
after approximately 259 ms with blocking mode and a 250 ms timeout.

## Visual verification

Captured from running production components in the repository's Playwright harnesses on Windows,
using bundled Chromium at 1280 × 900. The backend is a fixture; the installed application was not replaced.

| Entry point | Light | Dark |
| --- | --- | --- |
| Desktop local | [Screenshot](images/conversation-lag/static-activity-desktop-local-light.png) | [Screenshot](images/conversation-lag/static-activity-desktop-local-dark.png) |
| Desktop remote | [Screenshot](images/conversation-lag/static-activity-desktop-remote-light.png) | [Screenshot](images/conversation-lag/static-activity-desktop-remote-dark.png) |
| Web desktop | [Screenshot](images/conversation-lag/static-activity-web-desktop-light.png) | [Screenshot](images/conversation-lag/static-activity-web-desktop-dark.png) |

[Long streaming reply and editable draft](images/conversation-lag/static-streaming-reply.png).

Relevant regression suites:

- `chrome_plugin::native::tests`: idle timeout and fragmented TCP frame delivery.
- Existing Chrome session tests: idle survival, EOF and authorization revocation.
- `backgroundConversations.test.ts`, `conversationViews.test.ts`: local and remote event isolation.
- `deferred-tool-details.pw.ts`: static, readable activity text in all three desktop entry points.
- `streaming-motion.pw.ts`: long streaming text, status label, editable input and accessibility modes.
- `responsiveness.pw.ts`, `tool-history.pw.ts`: input, polling and full tool-output scrolling.
