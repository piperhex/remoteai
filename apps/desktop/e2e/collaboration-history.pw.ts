import { test, expect } from "@playwright/test";
import type { Conversation, Item } from "../../../shared/conversation/types";

const activity = (id: string, task: string, kind: string): Item => ({
  id, type: "subAgentActivity", kind, agentThreadId: `${task}-id`, agentPath: `/root/${task}`,
});
const items: Item[] = [
  activity("singapore-start", "singapore_weather", "started"),
  activity("hongkong-start", "hongkong_weather", "started"),
  { id: "wait", type: "collabAgentToolCall", tool: "wait", status: "completed" },
  activity("hongkong-message", "hongkong_weather", "interacted"),
  activity("singapore-done", "singapore_weather", "completed"),
  activity("hongkong-done", "hongkong_weather", "completed"),
  { id: "answer", type: "agentMessage", phase: "final_answer", text: "两地天气已汇总。" },
];
const fixture: Conversation = { thread: { id: "collaboration", cwd: "", preview: "", updatedAt: 1 },
  activeTurn: null, tokens: 0, error: "", turns: [{ id: "turn", status: "completed", items }] };

for (const width of [1280, 390]) {
  test(`collaboration history identifies both tasks and opens readable details at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.route("**/history-fixture.json", (route) => route.fulfill({ json: fixture }));
    await page.goto("/e2e/tool-history-harness.html");
    await page.locator("summary[data-history-anchor]").click();
    const group = page.locator('[data-activity-group="singapore-start"]');
    await expect(group.locator(':scope > details > summary')).toHaveAccessibleName(/查看全部 6 项活动/);
    await group.locator(':scope > details > summary').click();
    await expect(page.getByText("已启动协作任务 · singapore_weather", { exact: true })).toBeVisible();
    await expect(page.getByText("已启动协作任务 · hongkong_weather", { exact: true })).toBeVisible();
    const progress = page.locator('[data-message-id="hongkong-message"]');
    await progress.locator("summary").click();
    await expect(progress.locator("p")).toHaveText("协作消息 · hongkong_weather");
    await expect(progress.locator("pre")).toHaveCount(0);
    const wait = page.locator('[data-message-id="wait"]');
    await wait.locator("summary").click();
    await expect(wait.locator("p")).toHaveText("等待协作进展 · 本次等待结束");
    await page.getByLabel("消息", { exact: true }).fill("继续查询天气");
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue("继续查询天气");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `../../.codex-tmp/collaboration-history-${width}.png`, animations: "disabled" });
  });
}
