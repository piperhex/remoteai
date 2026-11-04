import { test, expect, type Page } from "@playwright/test";
import type { GuiEvent, Item, Thread, Turn } from "../../../shared/conversation/types";

function edit(id: string, added: number, removed: number): Item {
  const diff = `@@ -1,${removed} +1,${added} @@\n`
    + Array.from({ length: removed }, (_, index) => `-old ${index}\n`).join("")
    + Array.from({ length: added }, (_, index) => `+new ${index}\n`).join("");
  return { id, type: "fileChange", status: "completed",
    changes: [{ path: `src/${id}.ts`, kind: { type: "update" }, diff }] };
}

async function mockConversation(page: Page) {
  const turn: Turn = { id: "turn", status: "inProgress", startedAt: Date.now() / 1000, items: [
    { id: "user", type: "userMessage", content: [{ type: "text", text: "调整文件修改的展示方式" }] },
    edit("first", 23, 17),
  ] };
  const thread: Thread = { id: "changes", cwd: "", name: "文件修改展示", preview: "", updatedAt: 1, turns: [turn] };
  const events: { name: string; payload: GuiEvent }[] = [];
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/__codex_switch__/api/invoke", async (route) => {
    const { command, args = {} } = route.request().postDataJSON();
    let result: unknown = {};
    if (command === "codex_gui_cli_status") result = { version: "0.1.0" };
    if (command === "codex_gui_connect") result = [];
    if (command === "codex_gui_queue_read") result = { revision: 0, threads: {} };
    if (command === "codex_gui_queue_save") result = args.snapshot;
    if (command === "codex_gui_events") result = { cursor: { streamId: "test", sequence: events.length },
      reset: false, events: args.cursor ? events.slice(args.cursor.sequence) : [] };
    if (command === "codex_gui_model_settings") result = { threadId: null, selection: null, revision: 0 };
    if (command === "codex_gui_undo") result = { undone: false };
    if (command === "codex_gui_git") result = { cwd: "", branch: null, branches: [], changedFiles: 0, isWorktree: false };
    if (command === "codex_gui_usage_summary") result = { totalTokens: 0, estimatedCostUsd: 0,
      primaryRemainingPercent: null, primaryRemainingAggregated: false, providerEstimatedCost: null };
    if (command === "codex_gui_request") {
      let data: unknown = { data: [], nextCursor: null };
      if (args.request.operation === "models") data = { data: [{ id: "test-model", model: "test-model",
        displayName: "测试模型", isDefault: true, defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }] }], nextCursor: null };
      if (args.request.operation === "list") data = { data: [thread], nextCursor: null };
      if (["read", "resume"].includes(args.request.operation)) data = { thread };
      if (args.request.operation === "goals") data = { goals: [] };
      if (args.request.operation === "plugins") data = { marketplaces: [], marketplaceLoadErrors: [] };
      result = { data };
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  return { turn, notify: (event: GuiEvent) => events.push({ name: "codex-gui-event",
    payload: { ...event, params: { ...event.params, threadId: thread.id, turnId: turn.id } } }) };
}

for (const dark of [false, true]) {
  test(`running changes stay above the composer and become a final list (${dark ? "dark" : "light"})`, async ({ page }) => {
    const backend = await mockConversation(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/e2e/gui-features-harness.html" + (dark ? "?dark=1" : ""));
    await page.getByRole("button", { name: "文件修改展示", exact: true }).click();
    const badge = page.getByRole("button", { name: /^查看本轮修改：已编辑 .* 个文件/ });
    const cards = page.locator('[data-turn-id="turn"] section[aria-label]');
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await expect(badge).toHaveText("已编辑 1 个文件+23−17");
    await expect(cards).toHaveCount(0);
    await editor.fill("修改进行中仍可继续输入");
    const before = Number(await page.getByLabel("刷新次数").textContent());
    for (const item of [edit("second", 22, 16), edit("third", 22, 16)]) {
      backend.turn.items.push(item);
      backend.notify({ method: "item/completed", params: { item } });
    }
    await expect(badge).toHaveText("已编辑 3 个文件+67−49");
    await expect(cards).toHaveCount(0);
    await expect(editor).toHaveText("修改进行中仍可继续输入");
    expect(Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(before);
    const bounds = (await badge.boundingBox())!;
    const wrap = (await badge.locator("..").boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(400);
    expect(Math.abs(bounds.x + bounds.width / 2 - wrap.x - wrap.width / 2)).toBeLessThan(1);
    expect(bounds.y + bounds.height).toBeLessThan((await editor.boundingBox())!.y);
    await page.screenshot({ path: `../../.codex-tmp/running-changes-${dark ? "dark" : "light"}.png` });
    await badge.click();
    await expect(page.getByRole("dialog", { name: "文件更改详情" })).toBeVisible();
    await expect(page.getByLabel("src/first.ts 的代码差异")).toContainText("new 0");
    await page.getByRole("button", { name: "关闭详情抽屉", exact: true }).click();
    backend.turn.diff = backend.turn.items.flatMap((item) => item.changes ?? []).map((file) =>
      `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n${file.diff}`).join("");
    backend.notify({ method: "turn/diff/updated", params: { diff: backend.turn.diff } });
    backend.turn.status = "completed";
    backend.notify({ method: "turn/completed", params: { turn: backend.turn } });
    await expect(badge).toHaveCount(0);
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("已编辑 3 个文件");
    await expect(cards.locator("li")).toHaveCount(3);
    await expect(cards).toContainText("+67−49");
    await expect(editor).toHaveText("修改进行中仍可继续输入");
    await page.screenshot({ path: `../../.codex-tmp/completed-changes-${dark ? "dark" : "light"}.png` });
    expect(errors).toEqual([]);
  });
}
