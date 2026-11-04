import { test, expect } from "@playwright/test";
import type { Conversation } from "../../../shared/conversation/types";

const reply = "下架异常上报使用上架异常上报的接口";
const quote = "下架异常上报\n" + "引用内容较长时应自动换行。".repeat(30);
const fixture: Conversation = { thread: { id: "quotes", cwd: "", preview: "", updatedAt: 1 },
  activeTurn: null, tokens: 0, error: "", turns: [{ id: "turn", status: "completed", items: [
    { id: "user", type: "userMessage", content: [{ type: "text",
      text: "引用 AI 回答：\n" + quote.split("\n").map((line) => "> " + line).join("\n") + "\n\n" + reply }] },
    { id: "answer", type: "agentMessage", phase: "final_answer", text: "已处理。" },
  ] }] };

test("historical reply quotes use a capsule and wrap inside a compact popover", async ({ page }) => {
  await page.route("**/history-fixture.json", (route) => route.fulfill({ json: fixture }));
  await page.goto("/e2e/tool-history-harness.html");
  const chip = page.getByRole("button", { name: "查看 1 条引用", exact: true });
  await expect(chip).toBeVisible();
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  await expect(page.getByText("引用 AI 回答：", { exact: true })).toHaveCount(0);
  await chip.click();
  const preview = page.locator(".ant-popover-inner");
  await expect(preview.locator("blockquote")).toHaveText(quote);
  expect((await preview.boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: "../../.codex-tmp/message-quotes.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await page.getByLabel("消息", { exact: true }).fill("继续回复");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("继续回复");
  await page.reload();
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("aria-expanded", "false");
});
