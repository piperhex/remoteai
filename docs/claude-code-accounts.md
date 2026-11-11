# Claude Code accounts

The official-account menu offers Codex and Claude Code. Codex keeps its existing login dialog.
The `accountSource` field identifies the product independently of cloud-account ownership;
missing values mean Codex, and unknown future source identifiers remain displayable.

Claude Code offers three paths:

- **Official CLI login:** runs the installed, unmodified `claude auth login --claudeai` in a fresh
  configuration directory. The client opens the URL printed by the CLI and forwards the pasted code
  to its standard input. The CLI performs authorization and writes its own credentials.
- **Browser authorization-code login:** generates an independent random state and S256 PKCE verifier,
  validates callback origin/state, exchanges the code and reads the OAuth profile. This reuses the public
  CLI client identifier. It is explicitly labeled unofficial and compatibility is not guaranteed.
- **Import local account:** reads the target computer's current native CLI login into a managed profile.
  It does not modify the imported configuration or attempt Claude Desktop cookie/profile access.

The official CLI route was probed with Claude Code 2.1.322 on Windows. Its printed authorization
parameters were compared with the PKCE implementation. No real account authorization or token was used
in automated tests. Anthropic does not support third-party applications offering Claude.ai login:
[authentication](https://code.claude.com/docs/en/authentication),
[legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).

## Storage and account switching

The Rust service in `apps/desktop/src-tauri/src/claude_accounts` owns credentials and filesystem changes.
Saved accounts live alongside existing accounts as `accounts/claude_<id>/claude-profile.json`.
The token snapshot uses AES-256-GCM with the account ID as associated data; its key lives in the OS
credential store. Frontend responses contain account metadata only, and errors never include service
response bodies, tokens or local paths. Claude records have no Codex `auth.json`, so Codex synchronization,
quota consumption, automatic routing and credential export do not pick them up.

Each managed account has an isolated `CLAUDE_CONFIG_DIR`. Native CLI credentials still follow the CLI's
own format: credential files on Windows/Linux, and scoped Keychain entries on macOS. Keychain failures
are reported instead of silently accepting an outdated file. Temporary writes are replaced atomically;
authentication/configuration backups preserve unrelated settings, MCP entries and project preferences.
If committing selection fails, writes are rolled back unless an external process has already changed them.

Selecting an account refreshes expiring tokens, updates the default native CLI directory, and records the
default for new Remote AI Claude sessions. New sessions receive the account's isolated configuration and
the native Anthropic endpoint. Existing sessions retain their original account and model; there is no
claim that a running CLI reloads a different identity. A standalone CLI must be restarted and must not
have shell/project authentication overrides. Conflicting default `settings.json` overrides are reported.

Clearing the default only clears Remote AI's selection. It does not log out the standalone CLI. Deleting
a saved account removes its encrypted snapshot, while native profiles and session history remain available
to existing sessions. The confirmation explains this behavior.

Desktop remote mode and Web use the selected computer's authenticated chat transport. Credentials stay
on that computer; the Web account page includes an online-computer selector. Claude credentials are not
uploaded to Codex cloud-account storage.

## Token lifecycle and concurrency

Tokens are refreshed within five minutes of expiry. Refreshes are serialized per account. A newer native
CLI rotation is adopted before refreshing; a rejected refresh checks again for a concurrent native update.
Rotated tokens are committed before subsequent profile queries. Revision checks prevent an older write
from replacing a newer saved record. Selection changes and default-directory synchronization share a lock,
so a delayed refresh cannot undo an account switch. Native writes check for intervening changes and refuse
to overwrite credentials with a later expiry. External CLI processes do not participate in these locks,
so a detected conflict asks the user to retry instead of claiming cross-process transactional guarantees.

Login attempts expire after ten minutes and can be cancelled. The PKCE verifier is consumed once; cancelled
or expired attempts cannot save an account. Network/profile failures are distinct from authorization
rejection. No quota-query failure is used to infer logout.

## Validation

- Rust unit tests use temporary directories, a test-only encryption key and mock HTTP endpoints. They cover
  PKCE randomness/challenge, callback validation, expiry/cancellation, code exchange, refresh rotation,
  multi-account deduplication, encrypted metadata responses, isolated import, settings preservation,
  rollback, and rejecting older native credentials.
- CLI service tests cover selected-account environment isolation, creation without the proxy bridge, and
  retaining an existing session's account/model after the default changes.
- `apps/desktop/scripts/playwright.official-accounts.config.ts` runs the actual local account page, shared
  remote manager and Web account page with mock transports. It checks both login methods, errors, import,
  source selection, context-menu gestures, enlarged fonts, dark mode and language switching. These are
  browser-rendered application checks, not real remote-host OAuth sessions.
- Desktop/Web builds, native TypeScript checks, source boundaries and all four language catalogs are checked.

Real OAuth completion, actual OS credential-store access, macOS/Linux native login and a complete remote
host authorization session still need manual validation on those environments. Browser fixtures do not
establish third-party OAuth support or future compatibility.
