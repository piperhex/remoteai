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
`gui_ssh_execute` to run a command with the saved login credentials. The latter rechecks the profile
revision and account identity before loading credentials. Missing or changed profiles fail rather
than selecting a different server. A previously verified host fingerprint is required; first test
or connect to an unverified profile in SSH settings.

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
