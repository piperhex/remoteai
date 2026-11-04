# Agent Notes

Keep all instructions in this `AGENTS.md` file in English.

## Coze Submodule

- `apps/coze` is the independent `https://github.com/piperhex/remoteai-coze.git` Git submodule.
  Follow its own `AGENTS.md`. Commit and push Coze changes there before updating the parent gitlink.
- Coze owns its dependencies, localization package, tests, build scripts and CI releases. Do not add it
  back to the parent's npm workspaces or rebuild it as part of Remote AI releases.
- The parent owns the desktop integration and `shared/coze/runtime.json`, which pins a published,
  compatible signed runtime. Parent builds must work without initializing the optional submodule.
- Coze translations live only in its `packages/i18n`; the parent's package owns desktop integration copy.

## Admin Backend: Go Only

- The NestJS backend in `apps/admin` is no longer maintained. Its source is frozen: do not add features,
  fix business logic, or use it as a production deployment target.
- Use `apps/admin-go` for all backend features, fixes, database upgrades, and production deployments.
  Continue using `apps/admin-ui` for the admin interface.
- Keep the NestJS source only as a historical API contract and a baseline for local compatibility tests.
  Do not modify the frozen implementation to update contracts or pass tests; implement new features in Go
  and add corresponding tests.
- Production builds, deployment configuration, and operations documentation must not reintroduce the NestJS service.
  Use verified admin-go images for both updates and rollbacks.
- Store database upgrade scripts in `apps/admin-go/sql`.
  Follow `apps/admin-go/DEPLOYMENT.md` for production deployments.
- Use the `check`, `up`, and `verify` commands in `apps/admin-go/scripts/deployment_compose.py`
  for all admin-go updates and rollbacks. Preserve the complete Compose file list recorded by the current container;
  when TURN is enabled, retain `compose.desktop-relay.yml`.
  Check relay ports and networking before and after deployment. Working HTTP, chat WebSocket, or STUN connections
  alone do not establish that remote desktop works.
- When adding Go endpoints, check route coverage and authentication rules in
  `apps/admin-go/kong/existing-kong.example.yml`. Keep existing production routes in the repository as well.
  `go -C apps/admin-go test ./internal/server -run TestKong` must pass.

## Browser Tests on Windows

- Default to Playwright's bundled Chromium. Install it with `npx playwright install chromium`;
  never fall back to system Edge or Chrome when the bundled browser is missing.
- Repeated system-browser launches with fresh profiles can trigger Windows password checks and lock
  the signed-in account. Keep Windows account-lockout policy intact.
- Route test browser environment overrides through `scripts/test-browser.mjs`, which rejects system
  browser overrides on Windows. See `docs/browser-tests.md` for setup and verification.
- Use its `testBrowserLaunchOptions` for Chromium Playwright configurations and full-browser launches,
  or `testBrowserArguments` for raw Chromium launches. Bundled full Chromium can also trigger the
  password probe; preserve the workaround and existing launch flags, and keep them out of WebKit projects.

## Automatic Commit and Push

- After completing the requested changes and verifying them successfully, automatically commit the changes made for the current task and push the current branch to its configured upstream. Do not wait for a separate request to commit or push.
- Never include unrelated existing changes in the commit, except for verified task cleanup explicitly allowed by the End-of-Conversation Review below. If verification fails, the branch has no configured upstream, or the push is blocked for a reason other than remote updates, report the issue instead of bypassing checks or rewriting history.
- If remote updates are detected before or during a push, fetch the configured upstream and attempt to merge it into the current branch. After a successful merge, rerun the relevant checks and push again.
- If the merge produces conflicts, immediately abort it with `git merge --abort`, preserve local commits and existing work, and stop the push. Report the conflict instead of resolving it automatically or forcing the push.
- Also include tracked files changed only by line-ending differences rather than leaving them uncommitted.

## End-of-Conversation Review

- Before ending a conversation and sending the final response, query active conversations to determine
  whether the current conversation is the only active one. Prefer `gui_list_running_conversations` and read every page;
  running conversations waiting for input or approval also count as active.
  If the query is unavailable or the result is inconclusive, state that limitation instead of assuming exclusivity.
- If other conversations are still active, finalize and commit only completed, verified changes for the current task.
  Do not take over uncommitted work from other conversations.
- If the current conversation is confirmed to be the only active one, inspect all local uncommitted changes
  in this repository, including staged, unstaged, untracked, and line-ending-only changes.
  Match each change to its conversation, original requirements, implementation status, and verification results;
  use `gui_read_conversation` for known conversations. An idle conversation or a final response is not proof
  of completion: assess the actual changes and verification evidence.
- For tasks with clear ownership and fully implemented requirements, finish necessary cleanup and run relevant checks.
  After verification passes, create a separate commit for each task and push under the rules above.
  This explicitly allows finalizing completed work from other ended conversations, while excluding unrelated
  or incomplete changes from each commit.
- If tests or checks previously failed because concurrent conversations made interfering changes, first confirm
  that the current conversation is the only active one. Review the affected requirements and current code together,
  eliminate concurrent interference, and rerun both task-specific checks and checks covering their combined impact.
  Use the new results to assess completion. Separately commit and push each fully implemented, verified task;
  do not leave it pending solely because earlier checks failed.
  Do not attribute failures to concurrency without evidence or skip checks. Report tasks that still fail verification
  or remain incomplete as described below.
- For incomplete tasks, failed or missing verification, or uncertain ownership or completion, preserve the changes
  and their staging state. Do not commit prematurely, discard work, or create temporary commits to clear the workspace.
  Include a report table in the final response with these columns:
  `Conversation/task | Files | Completed work | Remaining work or uncertainties | Verification | Reason not committed and next steps`.
- Recheck that no other conversations are active before taking over work from ended conversations and before
  committing that work. Stop cross-conversation cleanup if activity changes.
  Preserve and report mixed changes that cannot be reliably separated; never stage everything indiscriminately
  and include unverified work in a commit.

## UI Design and Screenshot Evidence

- Every UI change must include screenshots of the updated interface captured from the running application.
  Inspect the screenshots before delivery and include them, or direct links to them, in the final response.
  Cover the affected screens and interaction states across the platforms, modes, and viewport sizes required
  by the parity rules below. Label each screenshot with its platform, mode, and state.
  If screenshots cannot be captured, report the blocker and the missing visual verification;
  do not claim that the UI change is fully verified.
- All UI changes must preserve the project's established visual identity while applying modern, clean,
  and polished design principles. Reuse existing components and design tokens to keep typography, colors,
  spacing, and interaction patterns consistent. Use clear visual hierarchy, balanced layouts, and restrained
  effects or motion that improve usability without compromising readability, accessibility, or performance.

## Unified UI Typography

- For desktop local mode, desktop remote mode, and web application UI, the shared font preference defaults
  to **14 CSS px**. `shared/appearance/fontSize.ts` owns `DEFAULT_FONT_SIZE = 14` and the supported global
  preference range of **12-24 px**. The preference is a theme input, not every component's rendered size.
- Desktop `DashboardApp.tsx` uses Ant Design's `compactAlgorithm` in both light and dark modes; web
  `WebLocaleProvider.tsx` uses the default/dark algorithm without compact mode. Preserve these existing
  host themes. At the default preference, ordinary application dialogs, forms, and tables use this hierarchy:

  | Role | Desktop local / remote | Web desktop | Implementation |
  | --- | --- | --- | --- |
  | Body, form labels, inputs, buttons, tabs, table headers and cells, empty states | 12 px | 14 px | Inherit the host component's `fontSize`; emphasize table headers with weight. |
  | Standard modal titles | 14 px | 16 px | Reuse the Modal title style (`fontSizeHeading5` and its matching line height). |
  | Secondary text token | 10 px | 12 px | Use `token.fontSizeSM` where appropriate; preserve existing shared metadata styles. |
  | Compact sidebar and navigation text | Existing 12-13 px styles | Existing corresponding styles | Preserve the shared component's hierarchy. |

- These values describe the default hierarchy, not fixed overrides. Prefer Ant Design's existing component
  typography and `theme.useToken()` over hardcoded sizes. Standard management dialogs, including Manage Groups,
  must not introduce independent 24 px titles, 18 px tabs, or 16 px body/control text to imitate a screenshot.
  Do not replace the desktop compact theme with web defaults to make their computed sizes identical.
  Use spacing, font weight, and theme colors for emphasis; keep controls and icons proportionate to nearby UI.
- Both application roots use `shared/appearance/ApplicationTypography.tsx` to pass the global preference to
  Ant Design. `useApplicationFontSize.ts` sets `--app-font-scale`, and `fontSizePlugin.ts` scales CSS/LESS pixel
  typography. Preserve this pipeline: do not bypass it with fixed inline sizes or scale a theme-derived size
  a second time. Prefer inherited or relative sizing for custom controls; reuse the host's font family.
- Codex GUI conversation text follows the global preference by default and may have its own saved size.
  Reuse `useGuiFontSize()` and `guiFontStyle()` for that existing scope. General management dialogs follow
  application typography; do not copy a conversation's custom font size into unrelated controls.
- Treat screenshots as layout and hierarchy references. OS display scaling, browser zoom, image resizing,
  and user font preferences can all change apparent size. Inspect the running UI's computed styles and the
  corresponding existing components before choosing sizes; never infer CSS pixels from screenshot pixels.
- Verify typography changes at the default setting and an enlarged global setting, including narrow desktop
  windows, both dialog tabs where applicable, and desktop local, remote, and web entry points. Inspect running
  screenshots for clipping, wrapping, and consistency with surrounding UI as required above.
- Native apps retain their platform typography and must use `textMetrics()` and the physical-device checks
  below. Preserve established mobile layouts and dedicated marketing/page-heading hierarchies; the standard
  dialog scale does not authorize flattening all headings or copying CSS pixel values into native text styles.

## User-Facing Prompts and Copy

- Write all user-facing prompts and copy in natural, clear, and easy-to-understand language. Do not mention implementation details, internal processes, or other technical details.
- Whenever a user request involves writing prompts or copy, proactively refine and improve the wording so it is concise, friendly, and accurate instead of simply repeating the user's original wording.
- Keep temporary messages, including hover tooltips, popovers, and confirmation prompts shown after a click, visually compact. Limit the text area to a maximum width of `400px`, which is roughly one line of 25 full-width Chinese characters at the standard body-text size. Wrap longer copy onto additional lines instead of widening the message.

## Context Menus: Right-Click and Touch Long-Press

- Whenever a menu can be opened with a right-click, also support opening the same menu with a touch long-press.
  Apply this requirement when adding or modifying context menu interactions across all applicable platforms and entry points.
  Preserve right-click behavior and verify that both gestures expose the same menu actions.

## Internationalization: Single Package

- Use the standalone `packages/i18n` package (`@remoteai/i18n`) as the single source of truth
  for translation resources and language metadata. This applies to all apps, shared modules, Rust and native
  platform resources, browser extensions, and build scripts. Respect existing maintenance boundaries
  for frozen code and third-party sources.
- Put all new or modified translatable user-facing content in the language package, including default and fallback
  text, status and error messages, accessibility labels, permission explanations, user agreements, and structured content.
  Do not add separate translation tables, inline multilingual objects, language-dependent copy branches,
  or hardcoded translatable interface text to business code.
- Access copy through public `@remoteai/i18n` entry points and existing app adapters. Prefer semantic keys for new copy
  and interpolate parameters into complete sentences instead of concatenating translated fragments.
  Language selection, preference persistence, subscriptions, and platform integration may stay in apps,
  but must not cause translation resources to become scattered again.
- Language files or copy sections that must remain in platform directories, such as Rust resources, system permissions,
  extension manifests, and embedded scripts, must be generated artifacts only.
  Maintain their sources in `packages/i18n/platform/` and register generation mappings in `packages/i18n/platform.json`.
  Do not maintain or manually edit generated copies.
- When adding or modifying copy, update keys and parameters for every released language of the affected module.
  Preserve the package's declared language availability and fallback policies; centralizing resources does not authorize
  releasing additional languages. Follow `packages/i18n/README.md` for resource organization and exceptions.
- Translate display text only. Preserve the original semantics of protocol values, status identifiers, database values,
  and user content. Decode existing service error text at the display boundary using the package's error formatting API;
  never determine business state from translated text.
- After changing resources or language metadata, run `npm run generate:i18n` and ensure `npm run check:i18n` passes
  before committing. Check language switching, fallback behavior, and offline resources at affected entry points.
  Do not bypass resource ownership requirements by weakening checks, adding unjustified exemptions, or copying translations.

## Desktop Local, Remote, and Web Parity

- By default, desktop changes must cover local and remote modes in `apps/desktop` and the desktop pages in `apps/web`
  within the same task. Keep corresponding features, appearance, interactions, and copy consistent without waiting
  for a reminder. An explicit user scope restriction takes precedence.
- When changing a feature or fixing an issue at any entry point, inspect the corresponding implementations at the other two.
  Prefer shared modules for reusable business logic, components, and styles to prevent future omissions.
- Keep layout, visual styling, interaction feedback, and status displays consistent across all three entry points,
  adapting to their window and desktop browser widths. Where platform capabilities prevent full parity,
  provide an appropriate adaptation and explain the differences and reasons at delivery.
- Before completion, verify affected functionality and appearance separately in desktop local mode, desktop remote mode,
  and web desktop pages. Report the parity results at delivery; changing or verifying only one entry point is insufficient.

## Mobile and Web Parity

- By default, mobile or phone changes must cover `apps/native` and the corresponding features in `apps/web`
  at mobile viewport sizes within the same task. Keep appearance, interactions, and copy consistent without waiting
  for a reminder. An explicit user scope restriction takes precedence.
- Web parity for mobile requests covers mobile viewport sizes only, excluding wide desktop layouts.
  Keep native and mobile web behavior consistent while adapting to each layout.
  Prefer shared modules for reusable business logic to prevent future omissions on either platform.
- Platform-specific changes, such as Android or iOS system capabilities, need not be copied directly into the browser.
  Check whether mobile web needs an appropriate adaptation and explain any unsynchronized parts and reasons at delivery.
- Before completion, verify affected functionality and appearance separately in the native app and at mobile web sizes.
  Report the parity results at delivery; changing only the native app does not complete a mobile request.

## Native Text Layout: Prevent Glyph Clipping

- When adding or modifying standalone native `Text` elements, such as titles, list entries, back buttons,
  navigation labels, or status messages, reuse `textMetrics(fontSize, lineHeight)` from `apps/native/src/theme/text.ts`.
  Reserve enough space above and below glyphs for Chinese, system fonts, and fallback fonts; do not set only `fontSize`.
- On Android, do not replace this helper with a fixed `lineHeight`. React Native's explicit line height can override
  font metrics and clip some vendor fonts. Retain the helper's `includeFontPadding`, vertical spacing, and minimum height
  so the system font determines the actual height needed. Use the helper's existing platform adaptation for iOS.
- Do not hide clipping by disabling font scaling, reducing font size, fixing text container heights, or hiding overflow.
  Parent containers must grow with larger fonts or wrapping; allow horizontal text to shrink and wrap as needed
  without squeezing icons. Where icon fonts or nested rich text require special layout, verify them separately
  and explain why the helper cannot be reused directly.
- When fixing clipping, also inspect the feature's page titles, entry points, back navigation bars, and related messages
  instead of fixing only the location shown in a screenshot. Check line height, vertical spacing, and wrapping
  on corresponding mobile web pages, following the mobile and web parity requirements.
- Before completion, test on a physical Android device with default and enlarged fonts, including system font scales
  of at least 1.0 and 1.3. Inspect screenshots to confirm complete Chinese glyphs and verify entry and back navigation.
  Passing type checks or builds, or observing normal text box dimensions, cannot replace visual verification.
  If physical-device testing is unavailable, explicitly state what remains unverified.

## Tauri 2 WebView Window Creation On Windows

- Do not create a `WebviewWindowBuilder` from a synchronous Tauri command on Windows. In this repo, opening the Token Usage window from a sync `#[tauri::command]` produced a native window shell, but the WebView content stayed white, the close button did not work reliably, and DevTools could not be opened.
- Use an `async fn` command for window creation instead. The working fix was changing `show_token_usage_window` from a synchronous command to `pub(crate) async fn show_token_usage_window(...) -> Result<(), String>`.
- If adding a new Tauri window label, also add it to `apps/desktop/src-tauri/capabilities/default.json`. For Token Usage, the label is `token-usage`.
- Prefer hash routing for single-page subwindows loaded from packaged assets, for example `WebviewUrl::App("index.html#token-usage".into())`, and keep the frontend route parser compatible with both query and hash routes.
- For auxiliary windows that previously got stuck, add a Rust-side close fallback in `on_window_event` that destroys the specific window label instead of hiding the main app.

## Tauri UI Responsiveness and Polling

- Do not expose blocking work through a synchronous `#[tauri::command]` when the frontend can call it during rendering, loading, polling, automatic refresh, or event handling. A synchronous command can block the Windows UI message thread and make the application appear frozen.
- Implement commands as `async fn` and move blocking work to `tauri::async_runtime::spawn_blocking` whenever the operation can wait on a `Mutex` or `RwLock`, access SQLite, read or write files, call blocking network APIs, inspect processes, or perform other potentially slow system work. Use native asynchronous I/O when it is already available.
- Never wait for a shared lock on the UI thread. This is especially important when another task can hold the lock across a network request, SQLite busy timeout, database migration, or filesystem scan.
- Keep database serialization guards alive for the complete read or write operation, not only while opening the connection or initializing the schema. UI callers must await the asynchronous command without performing database work themselves.
- Polling callbacks must be single-flight. If the previous refresh is still running, skip the next interval instead of starting an overlapping request. Clear timers and subscriptions when the component unmounts or the feature becomes inactive.
- High-frequency polling, such as the two-second proxy session refresh, must not synchronously scan conversation metadata, Provider files, model catalogs, or token-usage databases. Move the complete operation off the UI thread, including any helper functions it calls.
- If the headless web compatibility layer needs to call an asynchronous Tauri command, adapt it explicitly in its request worker, for example with the existing `block_on` helper. Do not change the desktop command back to a synchronous function for web compatibility.
- For changes to proxy, Provider, concurrent-routing, cloud-sync, or token-usage UI flows, verify responsiveness while requests are active and while the relevant polling view is open. Run Rust formatting and tests plus the desktop TypeScript/Vite production build before handing off the change.


## Clean Code Constraints

1. A single source file should generally not exceed **500 lines**. If it does, split it by responsibility.
2. A single function should generally not exceed **50 lines**.
3. A single React component should generally not exceed **200 lines**.
4. A single custom Hook should generally not exceed **150 lines**.
5. A function should have no more than **4 parameters**. Use an options object when more parameters are needed.
6. Control-flow nesting should not exceed **3 levels**. Prefer early returns to reduce nesting.
7. The cyclomatic complexity of a single function should not exceed **10**.
8. A single line of code should not exceed **120 characters**.
9. Each module should have one clear responsibility. Avoid God Objects and God Functions.
10. Avoid using `any`. If its use is truly necessary, the reason must be documented. Prefer `unknown` where appropriate.
11. Avoid magic numbers and magic strings. Extract them into meaningful constants.
12. Avoid duplicated code, but do not introduce unnecessary abstractions solely for the sake of DRY.
13. In React, separate business logic from presentation logic. Extract complex logic into custom Hooks or standalone functions.
14. Each `useEffect` should handle one clearly defined side effect or synchronization responsibility.
15. Avoid deeply nested ternary expressions and overly complex conditional logic in JSX.
16. Variable, function, and type names must clearly express their business meaning. Avoid meaningless abbreviations.
17. Comments should explain design decisions, constraints, and exceptional cases rather than restating what the code already does.
18. Do not keep commented-out code, dead code, unused variables, or unused dependencies.
19. Modules should communicate through public interfaces. Do not depend on another module's internal implementation details.
20. When modifying existing code, prioritize local consistency and avoid unrelated large-scale refactoring for small changes.
21. Rust source files should generally not exceed **500 lines**. Split large files by domain or responsibility.
22. A single Rust function should generally not exceed **50 lines**. Complex logic should be extracted into smaller functions or dedicated modules.
23. Tauri `command` functions should remain thin. They should primarily handle input validation, permission checks, state access, and delegation to service-layer logic.
24. Do not place complex business logic directly inside `#[tauri::command]` functions.
25. `main.rs` and `lib.rs` should only contain application bootstrap, plugin registration, command registration, and high-level module wiring. Avoid business logic in these files.
26. Organize Rust code by responsibility, for example:

```text
src-tauri/src/
├── commands/
├── services/
├── models/
├── state/
├── errors/
├── utils/
├── platform/
├── lib.rs
└── main.rs
```

27. Avoid large catch-all files such as `commands.rs`, `utils.rs`, or `models.rs`. Split them into domain-specific modules when they grow significantly.
28. Avoid `unwrap()` and `expect()` in production code unless failure represents a truly unrecoverable invariant. Prefer proper error propagation with `Result`.
29. Do not silently discard errors using patterns such as:

```rust
let _ = some_fallible_operation();
```

unless ignoring the error is intentional and documented.

30. Define meaningful application error types instead of returning arbitrary strings from internal Rust APIs.
31. Use `thiserror`-style typed errors for internal application logic where appropriate. Convert errors into frontend-safe representations only at the Tauri boundary.
32. Do not expose sensitive internal error details, filesystem paths, credentials, tokens, or stack information directly to the frontend.
33. Shared mutable state must have a clearly defined ownership model. Avoid unnecessary global mutable state.
34. When using `Mutex`, `RwLock`, or other synchronization primitives, keep lock scopes as short as possible.
35. Never hold a synchronous lock across an `.await` point.
36. Avoid blocking operations inside async Tauri commands. CPU-intensive or blocking I/O operations should be delegated to appropriate blocking tasks or worker threads.
37. Avoid unnecessary `clone()` calls. Prefer borrowing when ownership does not need to be transferred.
38. Avoid excessive use of `Arc<Mutex<T>>`. Use it only when shared ownership and mutation are actually required.
39. Prefer enums and strongly typed structures over string-based state or mode identifiers.

For example, prefer:

```rust
enum AccountStatus {
    Active,
    Disabled,
    Expired,
}
```

over:

```rust
let status = "active";
```

40. All data crossing the Tauri IPC boundary should use explicit serializable request and response types.
41. Do not expose large internal Rust structs directly through Tauri commands merely because they implement `Serialize`. Define dedicated DTOs when appropriate.
42. Validate all data received from the frontend. Never assume IPC input is trusted.
43. File paths received from the frontend must be validated before filesystem operations are performed.
44. Shell commands, process execution, filesystem access, and network operations must follow the principle of least privilege.
45. Never construct shell commands by directly concatenating untrusted frontend input.
46. Avoid exposing generic commands such as:

```rust
execute_command(command: String)
read_file(path: String)
write_file(path: String, content: String)
```

unless strict validation and permission restrictions are implemented.

47. Tauri capabilities and permissions should follow the principle of least privilege. Only enable APIs and scopes actually required by the application.
48. Platform-specific behavior should be isolated behind dedicated modules instead of scattering `#[cfg(...)]` blocks throughout business logic.

Prefer:

```text
platform/
├── windows.rs
├── macos.rs
└── linux.rs
```

rather than many unrelated platform checks across the codebase.

49. Unsafe Rust is prohibited unless absolutely necessary. Every `unsafe` block must include a comment explaining the safety invariant.
50. Run `cargo fmt` and ensure the code passes `cargo clippy` without unjustified warnings.
51. Do not suppress Clippy warnings globally merely to make CI pass. Suppress individual warnings only when there is a documented reason.
52. Public functions, complex domain types, and non-obvious invariants should have appropriate Rust documentation comments.
53. Unit tests should cover important pure business logic independently from the Tauri command layer.
54. Tauri commands should be testable indirectly by keeping business logic outside the IPC layer.
