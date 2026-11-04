# System Prompt Plugin Market Implementation Plan

> Historical plan: the NestJS implementation described below has been removed.
> Current backend changes belong to the Go `apps/admin` submodule; see [admin repositories](../../admin-submodules.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent system-prompt plugin marketplace tab where users publish, install, enable, upgrade, and uninstall structured injection/filter prompts.

**Architecture:** Add a `prompt_plugin_items` PostgreSQL model and authenticated NestJS JSON endpoints. The desktop Tauri layer fetches and validates DTOs, stores a small local install registry, and applies rules carrying `sourcePluginId` into the existing proxy state. React adds a third marketplace tab and a text-only publish modal while leaving archive-based community skills and official plugins unchanged.

**Tech Stack:** NestJS 11, TypeORM/PostgreSQL, Rust/Tauri 2, React 18, TypeScript, Ant Design, CSS modules, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-system-prompt-plugin-market-design.md`

## Global Constraints

- Prompt plugin payloads are JSON only; no file upload, script execution, or arbitrary path input.
- `type` is exactly `injection` or `filter`; filter text is at most 500 Unicode characters and injection text at most 5000.
- Keep Tauri commands asynchronous and move filesystem/network/state work into `spawn_blocking`.
- Preserve manually-authored rules; only rules carrying the matching `sourcePluginId` may be replaced or removed.
- Keep user-facing copy concise and natural; temporary messages stay within the project’s 400px maximum width.
- Do not include unrelated working-tree account-table changes in any task commit.

---

### Task 1: Add the server-side prompt-plugin model and migration

**Files:**
- Create: `apps/admin/src/modules/prompt-plugins/entities/prompt-plugin-item.entity.ts`
- Create: `apps/admin/sql/20260830-prompt-plugins.sql`
- Create: `apps/admin/src/modules/prompt-plugins/dto/create-prompt-plugin.dto.ts`
- Create: `apps/admin/src/modules/prompt-plugins/prompt-plugins.module.ts`
- Modify: `apps/admin/src/app.module.ts`
- Test: `apps/admin/__test__/prompt-plugins.service.spec.ts` (created in Task 2)

**Interfaces:**
- Produces `PromptPluginItemEntity`, `PromptPluginType`, and validated `CreatePromptPluginDto` for the service/controller tasks.

- [ ] **Step 1: Write the migration and entity.** Define `prompt_plugin_items` with UUID `id`, varchar `name` (120), varchar `version` (40), varchar `type` (16), text `text`, UUID `uploaderId`, integer `installCount`, and timestamp columns. Add a unique index on `("uploaderId", "name")`, a created-at index, and a foreign key to `users(id)` with `ON DELETE CASCADE`. Mirror the entity with `@Index(['uploaderId', 'name'], { unique: true })` and `@Column({ type: 'varchar', length: 16 }) type: PromptPluginType`.
- [ ] **Step 2: Add DTO validation.** Export `PromptPluginType = 'injection' | 'filter'`, use `@IsIn(['injection', 'filter'])`, `@IsString`, `@MinLength(1)`, and `@MaxLength` decorators for name/version/text. The DTO text limit is 5000; service validation applies the stricter 500-character limit for filters.
- [ ] **Step 3: Register the module.** Import `TypeOrmModule.forFeature([PromptPluginItemEntity])`, provide the service/controller placeholders from Task 2, and add `PromptPluginsModule` to `AppModule.imports`. Add `/prompt-plugins/{*any}` to the static-file exclusion list.
- [ ] **Step 4: Run the focused typecheck.** Run `npm run test:typecheck -w @codex-switch/backend`; it should pass after the module/entity files compile.
- [ ] **Step 5: Commit only this task.**

```bash
git add apps/admin/src/modules/prompt-plugins apps/admin/src/app.module.ts apps/admin/sql/20260830-prompt-plugins.sql
git commit -m "feat(backend): add prompt plugin storage model"
```

### Task 2: Implement authenticated prompt-plugin API and service tests

**Files:**
- Create: `apps/admin/src/modules/prompt-plugins/prompt-plugins.service.ts`
- Create: `apps/admin/src/modules/prompt-plugins/prompt-plugins.controller.ts`
- Create: `apps/admin/__test__/prompt-plugins.service.spec.ts`
- Modify: `apps/admin/src/modules/prompt-plugins/prompt-plugins.module.ts`

**Interfaces:**
- `GET /prompt-plugins` returns `{ items: PromptPluginMarketItem[] }`.
- `POST /prompt-plugins` accepts `{ name, version, type, text }` under `JwtAuthGuard`.
- `PATCH /prompt-plugins/:id` accepts the same JSON DTO and requires the original uploader.
- `GET /prompt-plugins/:id/install` increments `installCount` and returns one complete item.
- Service exports `validatePromptPluginInput`, `PromptPluginsService.list`, `.create`, `.update`, and `.install`.

- [ ] **Step 1: Write failing service tests.** Use the repository stub pattern from `apps/admin/__test__/skills.service.spec.ts` and assert:

```ts
it('trims and persists an injection prompt', async () => {
  await service.create(actor, { name: '  Concise  ', version: ' 1.0.0 ', type: 'injection', text: ' Be concise ' });
  expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Concise', version: '1.0.0', type: 'injection', text: 'Be concise', uploaderId: actor.id,
  }));
});

it('rejects filter text over 500 characters', async () => {
  await expect(service.create(actor, { name: 'x', version: '1.0.0', type: 'filter', text: 'x'.repeat(501) }))
    .rejects.toThrow('500');
});

it('only lets the publisher update and increments installs', async () => {
  repository.findOne.mockResolvedValue({ id: 'p-1', uploaderId: actor.id, version: '1.0.0' });
  await expect(service.update(other, 'p-1', validDto)).rejects.toThrow('publisher');
  repository.findOne.mockResolvedValue({ id: 'p-1', uploaderId: actor.id, installCount: 2 });
  await service.install('p-1');
  expect(repository.increment).toHaveBeenCalledWith({ id: 'p-1' }, 'installCount', 1);
});
```

- [ ] **Step 2: Run the tests to verify RED.** Run `npx vitest run __test__/prompt-plugins.service.spec.ts` in `apps/admin`; confirm failures identify missing service behavior.
- [ ] **Step 3: Implement validation and presentation.** Trim all text, validate version with `/^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/`, enforce type-specific text limits, reject empty values, and map dates to ISO strings. `present()` must never return internal repository fields beyond the public DTO.
- [ ] **Step 4: Implement ownership and install behavior.** `create` sets `uploaderId`; `update` loads the item, checks `uploaderId`, requires a different version, and saves; `install` loads the item, increments the counter, and returns it. Let `NotFoundException`, `ForbiddenException`, and `BadRequestException` match existing skills wording.
- [ ] **Step 5: Add controller routes and run GREEN.** Use `@Body`, `@Param`, `@CurrentUser`, and `@UseGuards(JwtAuthGuard)` exactly as the skills controller does. Run `npx vitest run __test__/prompt-plugins.service.spec.ts`; expected result is all prompt-plugin tests passing.
- [ ] **Step 6: Commit.**

```bash
git add apps/admin/src/modules/prompt-plugins apps/admin/__test__/prompt-plugins.service.spec.ts
git commit -m "feat(backend): expose prompt plugin market API"
```

### Task 3: Add Rust prompt-plugin ownership state and pure rule operations

**Files:**
- Create: `apps/desktop/src-tauri/src/prompt_plugins.rs`
- Modify: `apps/desktop/src-tauri/src/models/accounts.rs`
- Modify: `apps/desktop/src-tauri/src/local_proxy/system_prompt_filter.rs`
- Modify: `apps/desktop/src-tauri/src/local_proxy/system_prompt_injection.rs`
- Test: `apps/desktop/src-tauri/src/prompt_plugins.rs` (`#[cfg(test)]` module)

**Interfaces:**
- `PromptPluginItem` and `PromptPluginType` are serializable Rust DTOs matching the TypeScript item.
- `apply_prompt_plugin`, `remove_prompt_plugin`, and `set_prompt_plugin_enabled` operate on `ManagerStateFile` and a `PromptPluginRegistry` without I/O.
- `SystemPromptRule` gains `source_plugin_id: Option<String>` with serde camelCase/default compatibility.

- [ ] **Step 1: Write failing pure tests.** Add tests that start with one manual rule and one `sourcePluginId: "p-1"`, then assert installing `p-1` replaces only its old rule, uninstalling removes only its sourced rule, and toggling changes the sourced rule’s `enabled` flag without touching the manual rule.
- [ ] **Step 2: Run focused Rust tests to verify RED.** Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml prompt_plugins`; confirm the new symbols/tests fail before implementation.
- [ ] **Step 3: Extend the rule DTO compatibly.** Add `#[serde(default, skip_serializing_if = "Option::is_none")] source_plugin_id` and preserve it in the custom deserializer. Update the frontend `SystemPromptRule` type and both editor hooks to spread the existing rule when editing, so source ownership is not accidentally dropped.
- [ ] **Step 4: Implement pure operations.** Store registry entries as `{ version, type, textHash }`; remove old entries by plugin ID, append a named enabled rule, reject duplicate text owned by a different source/manual rule, and enforce the existing 100-rule limits plus the filter 500-character limit.
- [ ] **Step 5: Run GREEN and format.** Run `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml` and the focused test command; expected result is passing ownership tests.
- [ ] **Step 6: Commit.**

```bash
git add apps/desktop/src-tauri/src/prompt_plugins.rs apps/desktop/src-tauri/src/models/accounts.rs apps/desktop/src-tauri/src/local_proxy/system_prompt_filter.rs apps/desktop/src-tauri/src/local_proxy/system_prompt_injection.rs apps/desktop/src/types.ts apps/desktop/src/pages/SystemPromptFilterPage/useRuleEditor.ts apps/desktop/src/pages/SystemPromptInjectionPage/usePromptEditor.ts
git commit -m "feat(desktop): track prompt plugin rule ownership"
```

### Task 4: Wire Rust cloud transport, Tauri commands, and web compatibility

**Files:**
- Modify: `apps/desktop/src-tauri/src/cloud/mod.rs`
- Create: `apps/desktop/src-tauri/src/cloud/prompt_plugins.rs`
- Modify: `apps/desktop/src-tauri/src/prompt_plugins.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/web_server/dispatch_extended.rs`
- Modify: `apps/desktop/src-tauri/src/web_server/security.rs`
- Test: `apps/desktop/src-tauri/src/cloud/prompt_plugins.rs` (request/presentation tests)

**Interfaces:**
- Tauri commands: `list_prompt_plugins`, `publish_prompt_plugin`, `install_prompt_plugin`, `remove_prompt_plugin`, `set_prompt_plugin_enabled`.
- Frontend-facing command arguments are explicit DTOs: publish receives `{ name, version, type, text }`; install receives `pluginId` and fetches the canonical server item.

- [ ] **Step 1: Write failing transport/command tests.** Assert JSON serialization uses camelCase (`installedVersion`, `sourcePluginId`), invalid plugin types are rejected before state writes, and uninstalling an absent registry entry is idempotent.
- [ ] **Step 2: Run focused tests to verify RED.** Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml prompt_plugins`; confirm missing command/transport behavior fails.
- [ ] **Step 3: Implement cloud transport.** Add blocking reqwest helpers for `GET /prompt-plugins`, `POST /prompt-plugins`, `PATCH /prompt-plugins/:id`, and `GET /prompt-plugins/:id/install`, reusing cloud credential locking, refresh-on-401, and existing response errors. Do not log prompt text.
- [ ] **Step 4: Implement local state orchestration.** Resolve `prompt-plugin-state.json` under `app_data_dir`, read/write it atomically with `write_json_atomic`, load `ManagerStateFile`, apply pure operations, write state and registry, and restore the original state if the second write fails. Update runtime filter/injection configuration only after both writes succeed and emit `providers-changed`.
- [ ] **Step 5: Register commands and web dispatch.** Add commands to `lib.rs`; add matching `dispatch_extended` arms using `block_on`; add list-only commands to the LAN allowlist and keep mutating commands protected by the existing local authorization boundary.
- [ ] **Step 6: Run GREEN and formatting.** Run `cargo fmt --check` and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml prompt_plugins`; expected result is clean formatting and passing tests.
- [ ] **Step 7: Commit.**

```bash
git add apps/desktop/src-tauri/src/cloud apps/desktop/src-tauri/src/prompt_plugins.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/web_server/dispatch_extended.rs apps/desktop/src-tauri/src/web_server/security.rs
git commit -m "feat(desktop): connect prompt plugin market commands"
```

### Task 5: Add desktop API adapters and prompt-plugin domain types

**Files:**
- Modify: `apps/desktop/src/types.ts`
- Modify: `apps/desktop/src/api/backend.ts`
- Create: `apps/desktop/src/pages/promptPlugins/types.ts`
- Test: `apps/desktop/src/pages/promptPlugins/promptPluginHelpers.test.ts`

**Interfaces:**
- `PromptPluginItem`, `PromptPluginType`, `PromptPluginPublishInput`, and `PromptPluginBusyAction` are exported types.
- API functions: `fetchPromptPlugins`, `publishPromptPlugin`, `installPromptPlugin`, `removePromptPlugin`, `setPromptPluginEnabled`.

- [ ] **Step 1: Write failing helper tests.** Test `promptPluginTypeLabel('injection')`, `promptPluginTypeLabel('filter')`, and `promptPluginPreview` truncation/whitespace behavior; run the focused test command and confirm RED.
- [ ] **Step 2: Implement adapters.** Use `invoke` when `hasLocalBackend`; in preview mode fetch `${baseUrl}/prompt-plugins` and store only IDs/version/enabled state in a dedicated localStorage key. Publishing in preview mode must issue `POST` with JSON and throw a concise error when unauthenticated.
- [ ] **Step 3: Implement helpers and run GREEN.** Keep preview generation pure, return at most 200 characters for card summaries, and run the helper tests until they pass.
- [ ] **Step 4: Commit.**

```bash
git add apps/desktop/src/types.ts apps/desktop/src/api/backend.ts apps/desktop/src/pages/promptPlugins
git commit -m "feat(desktop): add prompt plugin API adapters"
```

### Task 6: Build the third marketplace tab, cards, and text-only publish modal

**Files:**
- Create: `apps/desktop/src/pages/promptPlugins/PromptPluginsMarket.tsx`
- Create: `apps/desktop/src/pages/promptPlugins/PromptPluginGrid.tsx`
- Create: `apps/desktop/src/pages/promptPlugins/PromptPluginPublishModal.tsx`
- Create: `apps/desktop/src/pages/promptPlugins/index.module.less`
- Modify: `apps/desktop/src/pages/SkillsMarketPage.tsx`
- Modify: `apps/desktop/src/pages/skillsMarket/types.ts`
- Modify: `apps/desktop/src/pages/skillsMarket/SkillsMarketToolbar/index.tsx`
- Modify: `apps/desktop/src/pages/skillsMarket/SkillsMarketToolbar/index.module.less`
- Modify: `apps/desktop/src/i18n.ts`
- Modify: `apps/desktop/src/styles.css`

**Interfaces:**
- `SkillsMarketTab` becomes `"community" | "official" | "prompt"`; toolbar renders all three in fixed order and uses `skills.prompt.search` for the prompt tab.
- `PromptPluginsMarket` accepts `{ active, authenticated, currentUserId, notify, onLogin, t }` and owns loading, query, publish, busy-action, and error state.

- [ ] **Step 1: Add translation keys.** Add English and Chinese copy for tab label, search, loading/empty/error, type labels, form labels/placeholders, validation errors, install/update/uninstall/enable/disable toasts, and concise card metadata. Keep copy implementation-free.
- [ ] **Step 2: Write the publish modal first.** Render only name, version, type segmented control, and text area; disable submit for missing values or type-specific length overflow; call `publishPromptPlugin` with trimmed values and close only after success.
- [ ] **Step 3: Implement the card/grid.** Show a visible “注入/过滤” (or English equivalent) badge, version, 200-character text preview, install count, publisher edit affordance, install/update/uninstall button, and enabled switch. Disable controls while the matching busy action is running.
- [ ] **Step 4: Implement market orchestration.** Load on mount, filter by name/text/type, refresh after every mutation, route unauthenticated publish/install attempts to the existing login callback, and show errors in the page alert.
- [ ] **Step 5: Integrate navigation.** Render `PromptPluginsMarket` from `SkillsMarketPage` when `activeTab === 'prompt'`; keep community and official components untouched except for the widened tab union. Ensure the toolbar portal still mounts into `skills-market-tabs` and `skills-market-topbar-actions`.
- [ ] **Step 6: Add styles and run the desktop build.** Keep cards consistent with existing market styles, add compact type badges and responsive modal layout, and run `npm run build -w @codex-switch/desktop`; expected result is exit code 0.
- [ ] **Step 7: Commit.**

```bash
git add apps/desktop/src/pages/promptPlugins apps/desktop/src/pages/SkillsMarketPage.tsx apps/desktop/src/pages/skillsMarket apps/desktop/src/i18n.ts apps/desktop/src/styles.css
git commit -m "feat(desktop): add system prompt market tab"
```

### Task 7: Complete regression verification and integration checks

**Files:**
- Modify: `docs/architecture.md` (document `prompt-plugin-state.json` and the prompt-plugin data flow)
- Test: existing backend and desktop Rust suites

- [ ] **Step 1: Verify backend.** Run `npm run check -w @codex-switch/backend`; require typecheck success and all Vitest files passing.
- [ ] **Step 2: Verify Rust.** Run `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`; require exit code 0 and no new warnings attributable to this feature.
- [ ] **Step 3: Verify desktop production build.** Run `npm run build -w @codex-switch/desktop`; require TypeScript and Vite success.
- [ ] **Step 4: Review the requirement checklist.** Confirm the third tab is after official plugins, publishing has no file picker, every card shows injection/filter type, install/upgrade/uninstall preserve manual rules, and ordinary plugin flows still use their existing implementations.
- [ ] **Step 5: Update architecture documentation and commit.** Add the new server table, endpoints, local registry, and runtime ownership boundary to `docs/architecture.md`, then commit only the documentation change.

```bash
git add docs/architecture.md
git commit -m "docs: document prompt plugin market flow"
```

