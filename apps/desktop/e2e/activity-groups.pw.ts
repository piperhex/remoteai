import { expect, test } from "@playwright/test";
import type { Conversation, Item } from "../../../shared/conversation/types";

const commands: Item[] = Array.from({ length: 120 }, (_, index) => ({ id: `command-${index}`,
  type: "commandExecution", command: `echo COMMAND-${index}`,
  status: index === 119 ? "inProgress" : "completed", aggregatedOutput: `result-${index}` }));
const fixture: Conversation = { thread: { id: "commands", cwd: "", preview: "", updatedAt: 1 },
  activeTurn: "turn", tokens: 0, error: "", turns: [{ id: "turn", status: "inProgress", items: [
    { id: "explanation", type: "agentMessage", phase: "commentary", text: "正在检查命令的展示效果。" },
    ...commands,
  ] }] };

test("consecutive operations show only the latest running row and reveal history on click", async ({ page }) => {
  await page.route("**/history-fixture.json", (route) => route.fulfill({ json: fixture }));
  await page.goto("/e2e/tool-history-harness.html");
  const group = page.locator('[data-activity-group="command-0"] > details');
  const summary = group.locator(":scope > summary");
  const arrow = summary.locator("svg").last();
  await expect(summary).toHaveText("正在运行 echo COMMAND-119");
  await expect(page.getByText("正在检查命令的展示效果。", { exact: true })).toBeVisible();
  await expect(page.locator('[data-message-id^="command-"]')).toHaveCount(0);
  await expect(arrow).toHaveCSS("opacity", "0");
  await summary.hover();
  await expect(arrow).toHaveCSS("opacity", "1");
  const before = await arrow.boundingBox();
  const row = await summary.boundingBox();
  expect(row!.x + row!.width - before!.x - before!.width).toBeLessThan(2);
  await page.screenshot({ path: "../../.codex-tmp/activity-group-hover.png", animations: "disabled" });
  await summary.click();
  await expect(page.locator('[data-message-id^="command-"]')).toHaveCount(120);
  const completed = page.locator('[data-message-id="command-0"] > details > summary');
  await expect(completed.locator("span")).toHaveCSS("animation-name", "none");
  await expect(completed.locator("svg").last()).toHaveCSS("opacity", "0");
  await completed.click();
  await expect(page.getByRole("region", { name: "工具内容" }).locator("pre code").last()).toHaveText("result-0");
  await page.getByLabel("消息", { exact: true }).fill("查看命令时继续输入");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("查看命令时继续输入");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-message-id^="command-"]')).toHaveCount(0);
  await expect(summary).toHaveText("正在运行 echo COMMAND-119");
});
