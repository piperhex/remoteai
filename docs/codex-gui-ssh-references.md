# Saved SSH connections in Codex GUI

Type `!` in the message composer to show saved SSH connections. Continue typing to filter by
connection name, hostname, username or port. Arrow keys select an entry; Enter, Tab or a click adds
its removable `!name` reference without sending the message. Escape closes the list. Loading,
empty and failed lists consume selection keys without submitting the draft.

Desktop local mode, desktop remote mode and Web use the same account-backed SSH profile store as
their terminal settings. References contain only a profile ID and display name. Queued messages,
history display and editing preserve the binding. Passwords and private keys are never put in the
reference, composer state, message context or tool output.

The host's authenticated `codex_gui` MCP exposes `gui_ssh_profiles` to read connection metadata,
`gui_ssh_execute` for a bounded command, and `gui_ssh_terminal` for an interactive PTY. Connection
preparation prefers the host's last saved
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

A `gui_ssh_execute` connection or authentication failure before command dispatch triggers a fresh synchronization
(with the same three-retry limit) and one new connection attempt. Changed host fingerprints are not
retried. Once a command might have been sent, neither failures nor nonzero exit codes cause replay.

Commands execute through SSH on the computer running Codex, including when controlled remotely or
through Web. Each `gui_ssh_execute` call starts a non-interactive session; use an explicit `cd` for a working directory.
The default command timeout is 30 seconds, with a maximum of 120 seconds. Combined stdout and stderr
are capped at 256 KiB. Results report the exit code, timeout and truncation. A timeout or lost response
does not prove the command stopped, so side effects must not be retried automatically.

## Interactive Agent terminals

`gui_ssh_terminal` keeps a PTY session alive between calls. Every action requires the current
conversation's `threadId`; opening also requires the exact saved `profileId` and its current
`revision` from `gui_ssh_profiles`. The host verifies conversation and login ownership before
returning output or sending input. Account changes invalidate the session.

| Action | Additional arguments | Behavior |
| --- | --- | --- |
| `open` | `profileId`, `revision`, optional `command`, optional `size: {cols, rows}` | Starts the command in a PTY, or a persistent shell if command is omitted; returns `sessionId` and initial output. |
| `read` | `sessionId`, optional `cursor`, optional `waitMs` | Reads from a byte cursor; waits up to 30 seconds for new output. |
| `write` | `sessionId`, `text`, optional `sensitive` | Sends text exactly as supplied, including control characters. |
| `password` | `sessionId` | Sends the saved SSH login password followed by Enter internally. |
| `resize` | `sessionId`, `size: {cols, rows}` | Changes the PTY dimensions. |
| `close` | `sessionId` | Closes the SSH channel and releases the retained session. |

For example, after reading the selected connection's current revision, open `sudo pwd`:

```json
{"action":"open","threadId":"CURRENT_THREAD","profileId":"SELECTED_PROFILE","revision":1,"command":"sudo pwd"}
```

Replace the example IDs and revision with the actual values. If the resulting output requests the
saved SSH login password, use `password` with the returned `sessionId`, then `read` from the returned
`cursor`. The password never enters the tool arguments or response. It may differ from the sudo
password; this action cannot supply a separate password, and key-only profiles may have no saved
login password. Send it only in response to an observed prompt authorized by the task.

For a persistent shell, omit `command`; subsequent `write` calls can run scripts and preserve `cd`
and shell variables. In JSON strings, use `\r` to press Enter, `\u0003` for Ctrl+C, and `\u0004` for
EOF. `sensitive: true` masks exact echoes of single-line input, including echoes split across SSH
packets; it does not hide the tool arguments from conversation history. Saved passwords are masked
automatically. Neither opening nor input is automatically retried, even after a lost response.

`read` defaults to cursor 0 and a 1-second wait. Keep the returned `cursor` for the next read.
Reads are replayable within the retained 256 KiB output buffer, with at most 64 KiB per response.
`truncated` means older output was discarded; `hasMore` indicates unread buffered bytes.
`waitTimedOut` ends only the read, leaving the script running. `closed` and `exitCode` report channel
termination; a missing exit code does not imply success. PTY output merges stdout and stderr and
may contain ANSI terminal sequences.

Close sessions created for the task when finished, including after process exit. Sessions expire
after 30 minutes without tool activity, are limited to 32 retained sessions and eight live SSH
connections on the host, and cannot survive an application restart. Graphical X11 applications
continue to use the terminal panel. Local, remote and Web conversations use this same host service;
the updated host must be running before the new MCP tool is available.

Verification uses desktop `SshMentions.test.tsx`, `conversationComposer.test.tsx`, both applications'
`scripts/playwright.ssh-mentions.config.ts`, Rust SSH reference, queue, edit and cloud-profile tests,
and the SSH client's encrypted loopback execution tests. Browser screenshots cover local, remote
and Web composers at normal and enlarged fonts, with light and dark themes.
Interactive coverage includes encrypted loopback PTY acceptance/rejection, exact command dispatch,
stdin, password bytes, resize, Ctrl+C and close, plus host tests for conversation/account isolation,
missing passwords, replayable output, bounded buffering and split-packet redaction.
