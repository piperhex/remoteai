import { test, expect } from "@playwright/test";
import type { Conversation } from "../src/pages/codexGui/types";

const title = "“等很久”是点切换后一直转圈，还是切换后发消息一直没有回复？";
const options = ["点切换后一直转圈", "切换后发消息等很久", "两种情况都有"];
const fixture: Conversation = { thread: { id: "async", cwd: "", preview: "", updatedAt: 1 },
  activeTurn: "turn", tokens: 0, error: "", turns: [{ id: "turn", status: "inProgress", items: [
    { id: "ask", type: "agentMessage", delivery: "async", phase: "final_answer", text: title,
      questions: [{ title, options }, { title: "还有哪些现象？", options: null }] },
  ] }] };

test("async questions show choices during work, preserve failed answers, and fit narrow windows", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 900 });
  await page.route("**/history-fixture.json", (route) => route.fulfill({ json: fixture }));
  const replies: unknown[] = [];
  await page.route("**/async-answer", (route) => {
    replies.push(route.request().postDataJSON());
    return route.fulfill({ status: replies.length === 1 ? 500 : 200, body: "{}" });
  });
  await page.goto("/e2e/tool-history-harness.html");
  const card = page.getByRole("region", { name: "需要你的补充" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("radio")).toHaveCount(3);
  await expect(card.getByRole("radio", { name: options[0], exact: true })).toBeChecked();
  expect(replies).toHaveLength(0);
  await expect(card.getByRole("button", { name: "关闭补充信息" })).toBeVisible();
  const answer = card.getByRole("textbox", { name: "还有哪些现象？" });
  await answer.press("Enter");
  expect(replies).toHaveLength(0);
  await card.getByRole("radio", { name: options[1], exact: true }).check();
  await card.getByRole("textbox", { name: "还有哪些现象？" }).fill("列表里也找不到这个账户");
  await answer.press("Shift+Enter");
  await expect(answer).toHaveValue("列表里也找不到这个账户\n");
  await answer.fill("列表里也找不到这个账户");
  await answer.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await answer.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  await answer.dispatchEvent("keydown", { key: "Enter", repeat: true });
  expect(replies).toHaveLength(0);
  await answer.press("Enter");
  await expect.poll(() => replies.length).toBe(1);
  await expect(answer).toBeEnabled();
  await expect(card.getByRole("textbox", { name: title, exact: true })).toHaveValue(options[1]);
  for (const width of [520, 1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    const composer = page.getByLabel("消息", { exact: true }).locator("..");
    await expect.poll(async () => {
      const questionBox = (await card.boundingBox())!;
      const composerBox = (await composer.boundingBox())!;
      return Math.abs(questionBox.width - composerBox.width) + Math.abs(questionBox.x - composerBox.x);
    }).toBeLessThan(2);
  }
  await page.getByLabel("消息", { exact: true }).fill("任务执行时仍然能输入");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("任务执行时仍然能输入");
  await page.screenshot({ path: "../../.codex-tmp/async-questions.png", animations: "disabled" });
  await card.getByRole("textbox", { name: title, exact: true }).fill("切换成功了，但回复慢");
  await card.getByRole("radio", { name: options[1], exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveCount(0);
  expect(replies).toHaveLength(2);
  expect(replies[1]).toMatchObject({ answers: ["切换成功了，但回复慢", "列表里也找不到这个账户"] });
});
