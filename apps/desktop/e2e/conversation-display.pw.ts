import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Conversation, Item } from "../src/pages/codexGui/types";

const text = "下面展示各类基础排版效果。\n\n## 展示测试\n\n这段包含**粗体文字**、`行内代码`和普通文本。"
  + "\n\n|项目|状态|\n|---|---|\n|文本|正常|\n|排版|正常|"
  + "\n\n```typescript\nconst message: string = '展示测试';\nconst ready: boolean = true;"
  + "\nconsole.log(message, ready);\n```"
  + "\n\n1. 检查内容顺序。\n2. 确认展示效果。\n\n本轮展示完成";
const comment: Item = { id: "progress", type: "agentMessage", phase: "commentary", status: "completed",
  text: "即将检查两次 PowerShell 命令输出与其间的进度说明是否按顺序展示。" };
const command: Item = { id: "command", type: "commandExecution", status: "completed",
  command: '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"'
    + ' -NoProfile -Command "Write-Output \'DISPLAY-FIRST\'"', aggregatedOutput: "DISPLAY-FIRST", exitCode: 0 };
const answer: Item = { id: "answer", type: "agentMessage", phase: "final_answer", status: "completed", text };
const emptyReason: Item = { id: "reason", type: "reasoning", summary: [] };
function fixture(items: Item[], running = false): Conversation {
  return { thread: { id: "display", cwd: "", preview: "展示测试", updatedAt: 1 },
    tokens: 0, error: "", activeTurn: running ? "turn" : null,
    turns: [{ id: "turn", status: running ? "inProgress" : "completed", startedAt: Date.now() / 1000,
      durationMs: 32_000, items: [{ id: "user", type: "userMessage", content: [{ type: "text",
        text: "展示标题、表格、代码块与两次命令结果。" }] }, ...items] }] };
}
async function open(page: Page, value: Conversation) {
  await page.route("**/history-fixture.json", (route) => route.fulfill({ json: value }));
  await page.goto("/e2e/tool-history-harness.html");
}
async function update(page: Page, value: Conversation) {
  await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("conversation-fixture", { detail })), value);
}

test("diff examples stay code blocks while actual file changes keep their review summary", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const patch = "--- a/display-demo.ts\n+++ b/display-demo.ts\n@@ -1 +1 @@\n-const value = 1;\n+const value = 2;";
  await open(page, fixture([{ ...answer, text: "差异示例\n\n```diff\n" + patch + "\n```\n\n以上仅为展示" }]));
  await expect(page.locator("pre")).toHaveText(patch + "\n");
  await expect(page.locator(".hljs-deletion").last()).toHaveText("-const value = 1;");
  await expect(page.locator(".hljs-addition").last()).toHaveText("+const value = 2;");
  await expect(page.getByText(/已编辑\s*1\s*个文件/)).toHaveCount(0);
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  expect(await page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n"))).toBe(patch);
  await page.screenshot({ path: "../../.codex-tmp/chat-display-alignment/diff-example.png", animations: "disabled" });
  const changed = fixture([{ id: "change", type: "fileChange", status: "completed",
    changes: [{ path: "display-demo.ts", kind: { type: "update" }, diff: patch }] },
    { ...answer, text: "文件修改已完成。" }]);
  changed.turns[0].diff = patch;
  await update(page, changed);
  await expect(page.getByText("本轮修改", { exact: true })).toBeVisible();
  const file = page.getByRole("button", { name: "display-demo.ts 修改 新增 1 行，删除 1 行", exact: true });
  await expect(file).toBeVisible();
  await file.click();
  await expect(page.getByLabel("display-demo.ts 的代码差异")).toContainText("const value = 2;");
  await expect(page.locator('[data-turn-id="turn"] > details')).not.toHaveAttribute("open");
});

test("sent images sit above the text bubble and small originals retain their natural size", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const url = "data:image/png;base64," + readFileSync("src-tauri/icons/128x128.png").toString("base64");
  const value = fixture([{ ...answer, text: "图片已收到。" }]);
  const user = value.turns[0].items[0];
  user.content = [{ type: "image", url }, { type: "image", url }, { type: "text", text: "检查这两张图片" }];
  await open(page, value);
  const message = page.locator('[data-message-id="user"]');
  const thumbnails = message.getByRole("button", { name: /^放大查看：图片附件/ });
  await expect(thumbnails).toHaveCount(2);
  const first = (await thumbnails.first().boundingBox())!;
  const last = (await thumbnails.last().boundingBox())!;
  const bubble = (await message.getByText("检查这两张图片", { exact: true }).locator("..").boundingBox())!;
  expect(first.width).toBeLessThanOrEqual(80);
  expect(first.y).toBe(last.y);
  expect(last.y + last.height).toBeLessThan(bubble.y);
  expect(Math.abs(last.x + last.width - (bubble.x + bubble.width))).toBeLessThan(2);
  await thumbnails.first().click();
  const viewer = page.getByRole("dialog", { name: "图片附件 1", exact: true });
  const original = viewer.locator("img");
  await expect.poll(() => original.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(128);
  expect((await original.boundingBox())!.width).toBe(128);
  expect((await original.boundingBox())!.height).toBe(128);
  await viewer.getByRole("button", { name: "放大图片", exact: true }).click();
  expect((await original.boundingBox())!.width).toBe(192);
  await viewer.getByRole("button", { name: "还原图片", exact: true }).click();
  expect((await original.boundingBox())!.width).toBe(128);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await page.screenshot({ path: "../../.codex-tmp/chat-display-alignment/sent-images-narrow.png",
    animations: "disabled" });
  user.content = [{ type: "image", url }];
  await update(page, value);
  await expect(thumbnails).toHaveCount(1);
  expect(await message.locator("article > div").count()).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("completed rich replies have a separate copy row and a wide table with working actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, fixture([emptyReason, answer]));
  const reply = page.locator('[data-message-id="answer"]');
  await expect(page.locator("details")).toHaveCount(0);
  await expect(reply.getByRole("heading", { level: 2 })).toHaveCSS("font-weight", "600");
  const paragraph = await reply.getByText("本轮展示完成", { exact: true }).boundingBox();
  const copy = reply.getByRole("button", { name: "复制消息", exact: true });
  expect((await copy.boundingBox())!.y).toBeGreaterThanOrEqual(paragraph!.y + paragraph!.height);
  await copy.click();
  expect(await page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n"))).toBe(text);
  const table = reply.getByRole("table");
  expect((await table.boundingBox())!.width).toBeGreaterThan(700);
  await expect(table.locator("th").first()).toHaveCSS("border-left-width", "0px");
  await reply.getByRole("region", { name: "表格", exact: true }).hover();
  await reply.getByRole("button", { name: "复制表格", exact: true }).click();
  expect(await page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n")))
    .toBe("项目\t状态\n文本\t正常\n排版\t正常");
  await reply.getByRole("button", { name: "展开表格" }).click();
  await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await reply.getByRole("button", { name: "自动换行" }).click();
  await expect(reply.locator("pre")).toHaveCSS("white-space", "pre-wrap");
  await page.screenshot({ path: "../../.codex-tmp/chat-display-alignment/reply-desktop.png", animations: "disabled" });
});

test("process folds on completion, preserves inspected output, and displays the short command", async ({ page }) => {
  await open(page, fixture([comment, command], true));
  const process = page.locator('[data-turn-id="turn"] > details');
  await expect(process).toHaveAttribute("open");
  await expect(process.locator("summary").last()).toHaveText("已运行 Write-Output 'DISPLAY-FIRST'");
  await update(page, fixture([comment, command, answer]));
  await expect(process).not.toHaveAttribute("open");
  await expect(process.locator("summary")).toHaveText("用时 32秒");
  await process.locator("summary").click();
  await process.locator("summary").last().click();
  await expect(process.getByRole("region", { name: "工具内容" }).first()).toHaveText(command.command!);
  await expect(process.getByRole("region", { name: "工具内容" }).last()).toHaveText("DISPLAY-FIRST");
  await update(page, fixture([comment, command, answer], true));
  await page.getByLabel("消息", { exact: true }).fill("查看输出时继续输入");
  await update(page, fixture([comment, command, answer]));
  await expect(process).toHaveAttribute("open");
  await expect(process.getByRole("region", { name: "工具内容" }).last()).toHaveText("DISPLAY-FIRST");
  await page.screenshot({ path: "../../.codex-tmp/chat-display-alignment/process-expanded.png",
    animations: "disabled" });
});

test("wide tables stay inside narrow dark conversations and remain readable when expanded", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const wide = "|一|二|三|四|五|六|\n|---|---|---|---|---|---|\n|甲|乙|丙|丁|戊|己|";
  await open(page, fixture([{ ...answer, text: text + "\n\n" + wide }]));
  await page.getByRole("button", { name: "切换主题" }).click();
  const table = page.getByRole("region", { name: "表格", exact: true }).last();
  await table.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(await table.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await table.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await table.hover();
  await page.getByRole("button", { name: "展开表格" }).last().click();
  await expect(page.getByRole("dialog")).toBeInViewport();
  await expect(page.getByRole("region", { name: "完整表格" })).toContainText("己");
  await page.getByRole("region", { name: "完整表格" }).evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await expect(page.locator(".ant-modal-content")).toHaveCSS("background-color", "rgb(31, 31, 31)");
  await page.screenshot({ path: "../../.codex-tmp/chat-display-alignment/table-narrow-dark.png",
    animations: "disabled" });
});

test("stopping preserves partial progress and a later reply does not inherit the stopped status", async ({ page }) => {
  await open(page, fixture([emptyReason], true));
  await expect(page.locator("details")).toHaveCount(0);
  await expect(page.getByText(/已处理/)).toHaveCount(0);
  await update(page, fixture([comment, command], true));
  const stopped = fixture([comment, command]);
  stopped.turns[0].status = "interrupted";
  await update(page, stopped);
  const process = page.locator('[data-turn-id="turn"] > details');
  await expect(process).toHaveAttribute("open");
  await expect(process.locator("summary").first()).toHaveText("已停止生成 · 用时 32秒");
  await expect(process.getByText(comment.text!, { exact: true })).toBeVisible();
  await expect(page.locator("[data-processing-phase]")).toHaveCount(0);
  const next = fixture([{ ...answer, text: "继续成功" }]).turns[0];
  await update(page, { ...stopped, turns: [...stopped.turns, { ...next, id: "next" }] });
  const reply = page.locator('[data-turn-id="next"]');
  await expect(reply).toContainText("继续成功");
  await expect(reply).not.toContainText("已停止生成");
  await page.screenshot({ path: "../../.codex-tmp/chat-display-alignment/stop-continue.png", animations: "disabled" });
});

test("local progress ticks phase and total time beside the reply and retains the completed duration", async ({ page }) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  const value = fixture([{ ...answer, status: "inProgress", text: "正在整理回复。" }], true);
  value.turns[0].startedAt = (now - 40_000) / 1000;
  value.processing = { turnId: "turn", id: "answer", phase: "response", startedAtMs: now - 10_000,
    activities: [], completedIds: [] };
  await open(page, value);
  const status = page.locator('[data-processing-phase="response"]');
  await expect(status).toHaveText("正在生成回复 · 10秒 (共计40秒)");
  await page.clock.runFor(2000);
  await expect(status).toHaveText("正在生成回复 · 12秒 (共计42秒)");
  const response = page.getByText("正在整理回复。", { exact: true });
  const bounds = (await response.boundingBox())!;
  expect((await status.boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(status).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: "../../.codex-tmp/local-processing-timing.png", animations: "disabled" });
  await update(page, { ...value, activeTurn: null, processing: undefined,
    turns: [{ ...value.turns[0], status: "completed", durationMs: 42_000 }] });
  await expect(status).toHaveCount(0);
  await expect(page.getByText("用时 42秒", { exact: true })).toBeVisible();
});
