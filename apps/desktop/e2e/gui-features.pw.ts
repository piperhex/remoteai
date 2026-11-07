import { test, expect, type Page } from "@playwright/test";
import { checkThreadSidebarResize } from "./thread-sidebar-resize";

const thread = { id: "conversation", cwd: "", name: "保留的对话", preview: "对话内容", updatedAt: 1, turns: [] };
const task = { id: "release", title: "跟踪 Remote AI 发布", prompt: "检查新版本发布。", cwd: "",
  schedule: { kind: "interval", minutes: 5 }, status: "active", nextRunAt: Date.now() + 300_000,
  lastRunAt: null, lastThreadId: "conversation", lastTurnId: null, runStatus: "idle", error: null };
const skill = { id: "gui-plugin", title: "项目检查助手", description: "整理项目状态，汇总需要跟进的事项。",
  version: "1.0.0", archiveSize: 100, archiveSha256: "", hasPreview: false, official: true,
  installCount: 12, createdAt: "2026-09-12", updatedAt: "2026-09-12", installed: false, enabled: false };
const migrationHomes = [
  { id: "default", path: "C:/Users/test/.codex", enabled: false },
  { id: "work", path: "D:/work/.codex", enabled: true },
  { id: "codex-gui", path: "C:/app/.codex", enabled: true },
];
const sourceThread = { sessionId: "source-conversation", sessionKind: "conversation", title: "准备迁移的对话",
  cwd: "D:/projects/example", updatedAt: Math.floor(Date.now() / 1000), sizeBytes: 1024, matchExcerpt: null,
  accountId: null, accountEmail: null, accountActive: false };

async function mockCommands(page: Page, migrationError?: string, grouped = false) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  let migrated = false;
  const sourceThreads = grouped ? [sourceThread, ...Array.from({ length: 70 }, (_, index) => ({
    ...sourceThread, sessionId: `source-${index}`, title: `项目历史对话 ${index + 1}`,
  }))] : [sourceThread];
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/__codex_switch__/api/invoke", async (route) => {
    const body = route.request().postDataJSON() as { command: string; args?: Record<string, unknown> };
    const { command, args = {} } = body;
    calls.push({ command, args });
    let result: unknown = {};
    if (command === 'codex_conversation_sync') {
      const request = args.request as { action: string; query?: string };
      if (request.action === 'homes') result = { name: 'Local PC', homes: migrationHomes };
      if (request.action === 'list') result = migrated || request.query === '没有这个对话' ? [] : sourceThreads;
      if (request.action === 'prepare') result = { id: 'prepared-local', size: 0, sha256: '' };
      if (request.action === 'plan') result = { count: 1, duplicateIds: [] };
      if (request.action === 'commit') {
        await new Promise(resolve => setTimeout(resolve, 800));
        if (migrationError) {
          await route.fulfill({ json: { ok: false, error: migrationError } });
          return;
        }
        migrated = true;
        result = { completedCount: 1, skippedCount: 0 };
      }
    }
    if (command === "get_app_settings") result = { codexHomes: migrationHomes };
    if (command === "browse_codex_threads") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      result = migrated || args.titleQuery === "没有这个对话" ? [] : [sourceThread];
    }
    if (command === "measure_codex_thread_tokens") result = [];
    if (command === "migrate_codex_threads_to_home") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (migrationError) {
        await route.fulfill({ json: { ok: false, error: migrationError } });
        return;
      }
      migrated = true;
      result = { requestedCount: 1, migratedCount: 1, skippedCount: 0, message: "已迁移 1 条会话" };
    }
    if (command === "codex_gui_cli_status") result = { version: "0.1.0" };
    if (command === "codex_gui_connect") result = [];
    if (command === "codex_gui_queue_read") result = { revision: 0, threads: {} };
    if (command === "codex_gui_queue_save") result = args.snapshot;
    if (command === "codex_gui_events") result = { cursor: { streamId: "test", sequence: 1 }, reset: false, events: [] };
    if (command === "codex_gui_model_settings") result = { threadId: null, selection: null, revision: 0 };
    if (command === "codex_gui_scheduled_tasks") result = [task];
    if (command === "list_market_skills") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      result = [skill, { ...skill, id: "notes", title: "笔记整理助手" }, { ...skill, id: "review", title: "代码审查助手" }];
    }
    if (command === "list_official_plugins" || command === "list_prompt_plugins") result = [];
    if (command === "codex_gui_git") result = { cwd: "", branch: null, branches: [], changedFiles: 0, isWorktree: false };
    if (command === "codex_gui_usage_summary") result = { totalTokens: 0, estimatedCostUsd: 0,
      primaryRemainingPercent: null, primaryRemainingAggregated: false, providerEstimatedCost: null };
    if (command === "codex_gui_request") {
      const request = args.request as { operation: string; search?: string; archived?: boolean };
      let data: unknown = { data: [], nextCursor: null };
      if (request.operation === "models") data = { data: [{ id: "test-model", model: "test-model",
        displayName: "测试模型", isDefault: true, defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }] }], nextCursor: null };
      if (request.operation === "list") data = { data: (migrated
        ? [thread, { ...thread, id: sourceThread.sessionId, name: sourceThread.title, cwd: sourceThread.cwd }]
        : [thread]).filter(entry => !request.archived && entry.name.includes(request.search ?? '')), nextCursor: null };
      if (request.operation === "read") data = { thread };
      if (request.operation === "goals") data = { goals: [] };
      if (request.operation === "plugins") data = { marketplaces: [], marketplaceLoadErrors: [] };
      result = { data };
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  return calls;
}

async function openGui(page: Page, suffix = "") {
  await page.goto("/e2e/gui-features-harness.html" + suffix);
  const expand = page.getByRole("button", { name: "展开对话列表" });
  if (await expand.isVisible()) await expand.click();
}

test('opens local search from the header icon and restores the list after closing', async ({ page }) => {
  await mockCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openGui(page);
  const trigger = page.getByRole('button', { name: '搜索对话', exact: true });
  await expect(page.getByRole('textbox', { name: '搜索对话', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: '../../.codex-tmp/local-search-sidebar.png' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '搜索对话', exact: true });
  const search = dialog.getByRole('textbox', { name: '搜索对话', exact: true });
  await expect(search).toBeFocused();
  await expect(search).toBeInViewport();
  await search.fill('不存在');
  await expect(dialog.getByText('没有找到匹配的对话')).toBeVisible();
  await search.fill('保留');
  const result = dialog.getByRole('button', { name: '保留的对话', exact: true });
  await expect(result).toBeInViewport();
  await page.screenshot({ path: '../../.codex-tmp/local-search-dialog.png', animations: 'disabled' });
  await result.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '保留的对话', exact: true })).toBeVisible();
  await trigger.click();
  await expect(search).toBeEmpty();
  await search.fill('不存在');
  await expect(dialog.getByText('没有找到匹配的对话')).toBeVisible();
  await search.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '保留的对话', exact: true })).toBeVisible();
  await trigger.click();
  await expect(search).toBeEmpty();
});

test('keeps archived local search in the dialog at a narrow desktop width', async ({ page }) => {
  await mockCommands(page);
  await page.setViewportSize({ width: 800, height: 700 });
  await openGui(page);
  await page.locator('.ant-segmented-item').filter({ hasText: '已归档' }).click();
  const trigger = page.getByRole('button', { name: '搜索对话', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '搜索对话', exact: true });
  const search = dialog.getByRole('textbox', { name: '搜索对话', exact: true });
  await expect(dialog.getByText('已归档对话', { exact: true })).toBeVisible();
  await search.fill('保留');
  await expect(dialog.getByText('没有找到匹配的对话')).toBeVisible();
  await search.fill('');
  await expect(dialog.getByText('还没有对话')).toBeVisible();
  await expect(search).toBeInViewport();
  await page.screenshot({ path: '../../.codex-tmp/local-search-dialog-narrow.png', animations: 'disabled' });
  await search.press('Escape');
  await page.locator('.ant-segmented-item').filter({ hasText: '最近' }).click();
  await expect(page.getByRole('button', { name: '保留的对话', exact: true })).toBeVisible();
  await trigger.click();
  await expect(search).toBeEmpty();
  await expect(dialog.getByText('最近对话', { exact: true })).toBeVisible();
});

test("local chat sidebar resizes, remembers its width and adapts to the available space", async ({ page }) => {
  await mockCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openGui(page);
  await checkThreadSidebarResize(page);
  const handle = page.getByRole("separator", { name: "调整聊天列表宽度" });
  await page.getByRole("button", { name: "收起对话列表" }).click();
  await expect(handle).toHaveCount(0);
  await page.getByRole("button", { name: "展开对话列表" }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "520");
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "520");
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(handle).toHaveAttribute("aria-valuenow", "380");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(700);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(handle).toHaveAttribute("aria-valuenow", "520");
  await page.screenshot({ path: "../../.codex-tmp/local-chat-sidebar-resize.png" });
});

test("feature navigation preserves drafts, filters tasks and scopes compact plugin cards to the GUI", async ({ page }) => {
  const calls = await mockCommands(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openGui(page);
  await page.getByRole("button", { name: "保留的对话", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("切换后继续编辑这条草稿");
  await page.getByRole("navigation", { name: "Codex GUI 导航" }).getByRole("button", { name: "定时任务" }).click();
  await expect(page.getByRole("heading", { name: "定时任务", exact: true })).toBeVisible();
  await expect(page.getByText(task.title, { exact: true })).toBeVisible();
  const search = page.getByPlaceholder("搜索已安排任务");
  await search.fill("没有这个任务");
  await expect(page.getByText(task.title, { exact: true })).toBeHidden();
  await search.clear();
  await page.screenshot({ path: "../../.codex-tmp/gui-scheduled-tasks-desktop.png", animations: "disabled" });
  await page.getByRole("navigation").getByRole("button", { name: "插件", exact: true }).click();
  const before = Number(await page.getByLabel("刷新次数").textContent());
  await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(before + 3);
  await expect(page.getByRole("heading", { name: skill.title, exact: true })).toBeVisible();
  await expect(page.getByText("Codex Home", { exact: true })).toHaveCount(0);
  const cards = page.locator(".skill-card");
  for (const card of await cards.all()) {
    const bounds = (await card.boundingBox())!;
    expect(bounds.width).toBeLessThan(350);
    expect(bounds.height).toBeLessThan(340);
  }
  await page.screenshot({ path: "../../.codex-tmp/gui-plugins-desktop.png", animations: "disabled" });
  await cards.first().getByRole("button", { name: "安装", exact: true }).click();
  await expect.poll(() => calls.filter((call) => call.command === "install_market_skill").length).toBe(1);
  expect(calls.filter((call) => ["list_market_skills", "install_market_skill"].includes(call.command))
    .every((call) => call.args.homeId === "codex-gui")).toBe(true);
  await page.getByRole("button", { name: "保留的对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveText("切换后继续编辑这条草稿");
  await page.getByText("已归档", { exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "定时任务", exact: true }).click();
  await page.getByRole("button", { name: "管理任务：" + task.title }).click();
  await page.getByRole("menuitem", { name: "查看任务对话" }).click();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveAttribute("aria-disabled", "false");
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveText("切换后继续编辑这条草稿");
  expect(errors).toEqual([]);
});

test("feature pages stay within a narrow dark viewport", async ({ page }) => {
  await mockCommands(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openGui(page, "?dark=1");
  await page.getByRole("navigation").getByRole("button", { name: "定时任务", exact: true }).click();
  await page.getByRole("button", { name: "收起对话列表" }).click();
  await expect(page.getByRole("heading", { name: "定时任务", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../../.codex-tmp/gui-scheduled-tasks-dark-narrow.png", animations: "disabled" });
  await page.getByRole("button", { name: "展开对话列表" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "插件", exact: true }).click();
  await page.getByRole("button", { name: "收起对话列表" }).click();
  await expect(page.getByRole("heading", { name: skill.title, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../../.codex-tmp/gui-plugins-dark-narrow.png", animations: "disabled" });
});

test("sync moves local conversations into the GUI and retains the conversation draft", async ({ page }) => {
  const calls = await mockCommands(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openGui(page);
  await page.getByRole("button", { name: "保留的对话", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("同步后继续编辑");
  const navigation = page.getByRole("navigation", { name: "Codex GUI 导航" });
  await expect(navigation.getByRole("button")).toHaveText(["新对话", "定时任务", "插件", "对话同步"]);
  await navigation.getByRole("button", { name: "对话同步", exact: true }).click();
  const pane = page.getByRole("region", { name: "对话同步", exact: true });
  await pane.getByRole('button', { name: '展开项目: D:/projects/example', exact: true }).click();
  await expect(pane.getByText(sourceThread.title, { exact: true })).toBeVisible();
  await pane.getByRole("combobox", { name: "来源目录" }).press("ArrowDown");
  await expect(page.locator(".ant-select-item-option")).toHaveText([
    "Local PC · C:/Users/test/.codex", "Local PC · D:/work/.codex",
  ]);
  await page.locator(".ant-select-item-option").filter({ hasText: "C:/Users/test" }).click();
  const search = pane.getByPlaceholder("搜索标题和对话内容");
  await search.fill("没有这个对话");
  await expect(pane.getByText("没有可同步的对话")).toBeVisible();
  await search.clear();
  await pane.getByRole('button', { name: '展开项目: D:/projects/example', exact: true }).click();
  await expect(pane.getByText(sourceThread.title, { exact: true })).toBeVisible();
  await pane.getByRole("checkbox").last().check();
  await pane.getByRole("button", { name: "对话同步", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认同步对话？", exact: true });
  await expect(dialog).toContainText("从来源目录移除");
  await expect(dialog.getByText("传输速度")).toHaveCount(0);
  await expect(dialog.getByText("连接方式")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "开始同步", exact: true })).toBeEnabled();
  await page.screenshot({ path: "../../.codex-tmp/conversation-sync-local-confirm.png", animations: "disabled" });
  await dialog.getByRole("button", { name: "开始同步", exact: true }).click();
  const before = Number(await page.getByLabel("刷新次数").textContent());
  await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(before + 3);
  await expect(dialog).toBeHidden();
  expect(calls.filter(call => call.command === "codex_conversation_sync")
    .some(call => (call.args.request as { action: string }).action === "commit")).toBe(true);
  expect(calls.find(call => (call.args.request as { action?: string } | undefined)?.action === "commit")?.args)
    .toEqual({ request: { action: "commit", id: "prepared-local", overwriteIds: [], modelProvider: "codex-switch-gui" } });
  await expect(pane.getByText("没有可同步的对话")).toBeVisible();
  await page.getByRole("button", { name: "保留的对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveText("同步后继续编辑");
});

for (const width of [860, 1440]) {
  test(`local sync keeps its toolbar and table inside the GUI viewport at ${width}px`, async ({ page }) => {
    await mockCommands(page, undefined, true);
    await page.setViewportSize({ width, height: 800 });
    await openGui(page);
    await page.getByRole('navigation').getByRole('button', { name: '对话同步', exact: true }).click();
    const pane = page.getByRole('region', { name: '对话同步', exact: true });
    const expand = pane.getByRole('button', { name: '展开项目: D:/projects/example', exact: true });
    await expect(expand).toBeVisible();
    await expand.click();
    const body = pane.locator('.ant-table-body');
    const header = pane.locator('.ant-table-header');
    const headerTop = (await header.boundingBox())!.y;
    const height = await body.evaluate(element => element.clientHeight);
    expect(height).toBeGreaterThan(100);
    expect(await body.evaluate(element => element.scrollHeight)).toBeGreaterThan(height);
    expect((await body.boundingBox())!.y + height).toBeLessThanOrEqual(800);
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(pane.getByText('项目历史对话 70', { exact: true })).toBeInViewport();
    await expect(pane.getByRole('button', { name: '对话同步', exact: true })).toBeInViewport();
    expect((await header.boundingBox())!.y).toBe(headerTop);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
    expect(await pane.evaluate(element => element.parentElement!.scrollTop)).toBe(0);
    await page.screenshot({ path: `../../.codex-tmp/sync-table-local-gui-${width}-scrolled.png`,
      animations: 'disabled' });
  });
}

for (const width of [800, 1280]) {
  test(`local sync failures retain the source selection at ${width}px`, async ({ page }) => {
    await mockCommands(page, "CONVERSATION_SYNC_CHANGED");
    await page.setViewportSize({ width, height: 1000 });
    await openGui(page, "?dark=1");
    await page.getByRole("navigation").getByRole("button", { name: "对话同步", exact: true }).click();
    const pane = page.getByRole("region", { name: "对话同步", exact: true });
    await pane.getByRole('button', { name: '展开项目: D:/projects/example', exact: true }).click();
    await expect(pane.getByText(sourceThread.title, { exact: true })).toBeVisible();
    await pane.getByRole("checkbox").last().check();
    await pane.getByRole("button", { name: "对话同步", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "确认同步对话？", exact: true });
    await dialog.getByRole("button", { name: "开始同步", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("对话内容已发生变化");
    await expect(dialog.getByRole("button", { name: "开始同步", exact: true })).toBeEnabled();
    await expect(pane.getByRole("checkbox").last()).toBeChecked();
    expect((await dialog.getByRole("alert").boundingBox())!.width).toBeLessThanOrEqual(400);
    await page.screenshot({ path: `../../.codex-tmp/conversation-sync-local-error-${width}.png`, animations: "disabled" });
  });
}
