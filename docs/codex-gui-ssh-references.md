# Saved SSH connections in Codex GUI

Type `!` in the message composer to show saved SSH connections. Continue typing to filter by
connection name, hostname, username or port. Arrow keys select an entry; Enter, Tab or a click adds
its removable `!name` reference without sending the message. Escape closes the list. Loading,
empty and failed lists consume selection keys without submitting the draft.

Desktop local mode, desktop remote mode and Web use the same account-backed SSH profile store as
their terminal settings. References contain only a profile ID and display name. Queued messages,
history display and editing preserve the binding. Passwords and private keys are never put in the
reference, composer state, message context or tool output.

The host's authenticated `codex_gui` MCP exposes `gui_ssh_profiles` to read connection metadata and
`gui_ssh_execute` to run a command with the saved login credentials. Both prefer the host's last saved
snapshot, scoped to the signed-in account, cloud server, profile ID and revision. Every cached use
refreshes the relevant list and credentials in the background for the next call. A failed cloud read
gets three additional attempts with bounded backoff; working cached connections do not wait for it.
Without a usable cache, synchronization completes before SSH connects. Missing or changed profiles fail rather
than selecting a different server. A previously verified host fingerprint is required; first test
or connect to an unverified profile in SSH settings.

Snapshots persist as authenticated AES-GCM ciphertext under the host's application data directory;
the random encryption key stays in the operating-system credential store. If that store or disk is
unavailable, the login remains usable through a session-local memory cache. Logout/account changes
invalidate in-flight sessions; successful profile refreshes and edits remove stale cached credentials.
Remote profile changes become visible after synchronization, rather than being checked synchronously
before every cached connection. Credentials never enter browser storage, messages or tool results.

A connection or authentication failure before command dispatch triggers a fresh synchronization
(with the same three-retry limit) and one new connection attempt. Changed host fingerprints are not
retried. Once a command might have been sent, neither failures nor nonzero exit codes cause replay.

Commands execute through SSH on the computer running Codex, including when controlled remotely or
through Web. Each call starts a non-interactive session; use an explicit `cd` for a working directory.
The default command timeout is 30 seconds, with a maximum of 120 seconds. Combined stdout and stderr
are capped at 256 KiB. Results report the exit code, timeout and truncation. A timeout or lost response
does not prove the command stopped, so side effects must not be retried automatically. Interactive
and X11 applications continue to use the terminal panel.

Verification uses desktop `SshMentions.test.tsx`, `conversationComposer.test.tsx`, both applications'
`scripts/playwright.ssh-mentions.config.ts`, Rust SSH reference, queue, edit and cloud-profile tests,
and the SSH client's encrypted loopback execution tests. Browser screenshots cover local, remote
and Web composers at normal and enlarged fonts, with light and dark themes.
