import { test, expect } from "@playwright/test";
import type { Conversation } from "../../../shared/conversation/types";

const CONTINUE_MESSAGE = "请继续完成刚才中断的任务。";

const wrap = (value: unknown) => `<codex_gui_conversation_context>${JSON.stringify(value)}
</codex_gui_conversation_context>`;
const awareness = wrap({ kind: "awareness", running: [{ id: "other", cwd: "D:/private" }], total: 1 });
const reference = wrap({ kind: "reference", id: "source", name: "设计讨论", messages: [{ text: "内部参考内容" }] });
function fixture(status: string): Conversation {
  return { thread: { id: "context", cwd: "", preview: "", updatedAt: 1 },
    activeTurn: null, tokens: 0, error: "", turns: [
      { id: "stopped", status, items: [{ id: "user", type: "userMessage",
        content: [{ type: "text", text: `请处理这个问题${reference}${awareness}` }] }] },
      { id: "resumed", status: "completed", items: [
        { id: "continue", type: "userMessage", content: [{ type: "text", text: CONTINUE_MESSAGE + awareness }] },
        { id: "answer", type: "agentMessage", phase: "final_answer", text: "问题已处理。" },
      ] },
    ] };
}

for (const width of [390, 1280]) {
  for (const status of ["interrupted", "failed"]) {
    test(`hides joined context and automatic continuation at ${width}px after ${status}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.route("**/history-fixture.json", (route) => route.fulfill({ json: fixture(status) }));
      await page.goto("/e2e/tool-history-harness.html");
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        await expect(page.getByText("问题已处理。", { exact: true })).toBeVisible();
        await expect(page.getByText("请处理这个问题", { exact: true })).toBeVisible();
        await expect(page.getByText("引用对话：设计讨论", { exact: true })).toBeVisible();
        await expect(page.getByText(CONTINUE_MESSAGE, { exact: false })).toHaveCount(0);
        for (const hidden of ["codex_gui_conversation_context", "D:/private", "内部参考内容"]) {
          await expect(page.locator("body")).not.toContainText(hidden);
        }
      }
      await page.getByLabel("消息", { exact: true }).fill("补充说明");
      await expect(page.getByLabel("消息", { exact: true })).toHaveValue("补充说明");
      await page.screenshot({ path: `../../.codex-tmp/context-display-fix/${status}-${width}.png` });
    });
  }
}
