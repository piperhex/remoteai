import { test, expect, type Page } from "@playwright/test";

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

async function mockCommands(page: Page) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  let migrated = false;
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/__codex_switch__/api/invoke", async (route) => {
    const body = route.request().postDataJSON() as { command: string; args?: Record<string, unknown> };
    const { command, args = {} } = body;
    calls.push({ command, args });
    let result: unknown = {};
    if (command === "get_app_settings") result = { codexHomes: migrationHomes };
    if (command === "browse_codex_threads") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      result = migrated || args.titleQuery === "没有这个对话" ? [] : [sourceThread];
    }
    if (command === "measure_codex_thread_tokens") result = [];
    if (command === "migrate_codex_threads_to_home") {
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
      const request = args.request as { operation: string };
      let data: unknown = { data: [], nextCursor: null };
      if (request.operation === "models") data = { data: [{ id: "test-model", model: "test-model",
        displayName: "测试模型", isDefault: true, defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }] }], nextCursor: null };
      if (request.operation === "list") data = { data: migrated
        ? [thread, { ...thread, id: sourceThread.sessionId, name: sourceThread.title, cwd: sourceThread.cwd }]
        : [thread], nextCursor: null };
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

test("migration reuses session management in the chat pane and excludes the GUI only as a source", async ({ page }) => {
  const calls = await mockCommands(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openGui(page);
  await page.getByRole("button", { name: "保留的对话", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("迁移后继续编辑");
  const navigation = page.getByRole("navigation", { name: "Codex GUI 导航" });
  await expect(navigation.getByRole("button")).toHaveText(["新对话", "定时任务", "插件", "对话迁移"]);
  await navigation.getByRole("button", { name: "对话迁移", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "对话迁移" })).toHaveAttribute("aria-current", "page");
  const pane = page.getByRole("region", { name: "对话迁移", exact: true });
  const before = Number(await page.getByLabel("刷新次数").textContent());
  await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(before + 3);
  await expect(pane.getByText("example", { exact: true })).toBeVisible();
  expect((await pane.boundingBox())!.x).toBeGreaterThan((await navigation.boundingBox())!.x);
  await pane.getByRole("combobox", { name: "选择管理的 Codex Home" }).press("ArrowDown");
  await expect(page.locator(".ant-select-item-option")).toHaveText([
    "默认目录 · C:/Users/test/.codex", "D:/work/.codex",
  ]);
  await page.locator(".ant-select-item-option").filter({ hasText: "默认目录" }).click();
  const search = pane.getByPlaceholder("搜索标题和会话内容");
  await search.fill("没有这个对话");
  await expect(pane.getByText("没有匹配的会话")).toBeVisible();
  await search.clear();
  await expect(pane.getByText("example", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "条会话", exact: true }).click();
  await expect(pane.getByText(sourceThread.title, { exact: true })).toBeVisible();
  await pane.getByRole("checkbox", { name: "全选全部会话" }).check();
  await pane.getByRole("button", { name: "对话迁移", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认迁移对话？", exact: true });
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(dialog.getByText("默认目录 · C:/Users/test/.codex", { exact: true })).toBeVisible();
  await expect(dialog.getByText("内置 Codex GUI", { exact: true })).toBeVisible();
  await expect(dialog.getByText("所选对话", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1 条", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCSS("transform", "none");
  await page.screenshot({ path: "../../.codex-tmp/gui-migration-confirm.png", animations: "disabled" });
  expect(calls.filter((call) => call.command === "migrate_codex_threads_to_home")).toEqual([]);
  await dialog.getByRole("button", { name: /^关\s*闭$/ }).click();
  await expect(dialog).toBeHidden();
  expect(calls.filter((call) => call.command === "migrate_codex_threads_to_home")).toEqual([]);
  await pane.getByRole("button", { name: "对话迁移", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(pane.getByRole("combobox", { name: "选择管理的 Codex Home" })).toBeDisabled();
  await dialog.getByRole("button", { name: "开始迁移", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(calls.find((call) => call.command === "migrate_codex_threads_to_home")?.args).toEqual({
    request: { homeId: "default", targetHomeId: "codex-gui", sessionIds: [sourceThread.sessionId] },
  });
  expect(calls.filter((call) => call.command === "browse_codex_threads")
    .every((call) => call.args.homeId !== "codex-gui")).toBe(true);
  await expect(pane.getByText("暂无 Codex 会话")).toBeVisible();
  await expect(page.getByRole("button", { name: sourceThread.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保留的对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveText("迁移后继续编辑");
  expect(errors).toEqual([]);
});

test("migration list fits a narrow dark chat pane", async ({ page }) => {
  await mockCommands(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openGui(page, "?dark=1");
  await page.getByRole("navigation").getByRole("button", { name: "对话迁移", exact: true }).click();
  await page.getByRole("button", { name: "收起对话列表" }).click();
  const pane = page.getByRole("region", { name: "对话迁移", exact: true });
  await expect(pane.getByText("example", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "条会话", exact: true }).click();
  await expect(pane.getByText(sourceThread.title, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "../../.codex-tmp/gui-migration-dark-narrow.png", animations: "disabled" });
});
