# Running command summaries

Remote conversation subscriptions were registered under the persistent terminal owner, but outgoing
events and disconnect cleanup looked them up by connection ID. The lookup failed and stripped command
previews from live events. History refreshes could restore previews later. Connections on the same
account also shared the wrong detail-loading preference: a PC's deferred mode could make a legacy
phone receive summaries it did not know how to display.

Conversation selection and detail preferences now belong to each connection. Only terminal operations
use the persistent account owner, preserving terminal reconnection. Deferred clients receive the command
preview and exact detail reference at `item/started`, without command bodies or output. Opening the item
fetches its details; collapsing it stops refreshes. Existing legacy-client compatibility remains separate.

## Verification

- Regression tests reproduced both missing live summaries and missing legacy-phone history before the fix.
- 44 targeted tests passed, covering connection isolation, cleanup, terminal ownership and detail transport.
- Desktop production build, test type checking and application boundary checks passed.
- 12 Playwright cases passed across desktop local, desktop remote, desktop Web and mobile Web, covering
  immediate summaries, no requests while collapsed, loading, live output, completion, collapse and retry.

Screenshots below were inspected from running production components in the bundled Chromium test harness.
The collapsed case routes a running command through the real `ChatOperations` and `ConversationViews`;
detail responses are fixtures. Desktop viewports are 1280 × 900 and mobile Web is 390 × 844, all in light mode.
The installed desktop app was not replaced, and the Android app was not updated or physically retested.
Legacy-phone compatibility is covered at the host protocol boundary; it is not a native UI verification.

| Platform / mode | Running, collapsed | Running, expanded |
| --- | --- | --- |
| Desktop local | [Summary](images/command-summary-routing/desktop-local-running-collapsed.png) | [Details](images/command-summary-routing/desktop-local-running-expanded.png) |
| Desktop remote | [Summary](images/command-summary-routing/desktop-remote-running-collapsed.png) | [Details](images/command-summary-routing/desktop-remote-running-expanded.png) |
| Web desktop | [Summary](images/command-summary-routing/web-desktop-running-collapsed.png) | [Details](images/command-summary-routing/web-desktop-running-expanded.png) |
| Web mobile | [Summary](images/command-summary-routing/web-mobile-running-collapsed.png) | [Details](images/command-summary-routing/web-mobile-running-expanded.png) |
