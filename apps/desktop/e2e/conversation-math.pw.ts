import { expect, test, type Page } from "@playwright/test";
import fixtureText from "../../../shared/chat/markdownFixture.json" with { type: "json" };
import type { Conversation } from "../../../shared/conversation/types";

function fixture(text: string): Conversation {
  return { thread: { id: "math", cwd: "", preview: "公式验证", updatedAt: 1 },
    tokens: 0, error: "", activeTurn: null, turns: [{ id: "turn", status: "completed", items: [
      { id: "user", type: "userMessage", content: [{ type: "text", text: "请用公式解释糖果题。" }] },
      { id: "answer", type: "agentMessage", phase: "final_answer", text },
    ] }] };
}
async function open(page: Page, text: string) {
  await page.route("**/history-fixture.json", route => route.fulfill({ json: fixture(text) }));
  await page.goto("/e2e/tool-history-harness.html");
}

test("local PC replies render math with bundled fonts and copy the unchanged source", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { markdownAnswer } = fixtureText;
  await open(page, markdownAnswer);
  const reply = page.locator('[data-message-id="answer"]');
  await expect(reply.locator(".katex")).toHaveCount(6);
  await expect(reply.locator(".katex-display .fbox")).toBeVisible();
  await expect(reply.locator(".katex-error")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check("16px KaTeX_Main"))).toBe(true);
  await reply.getByRole("button", { name: "复制消息", exact: true }).click();
  expect(await page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n")))
    .toBe(markdownAnswer);
  await page.screenshot({ path: info.outputPath("local-pc-math.png"), animations: "disabled" });
});

test("long formulas scroll within a narrow dark conversation while typing stays available", async ({ page }, info) => {
  await page.setViewportSize({ width: 420, height: 844 });
  const terms = Array.from({ length: 60 }, (_, index) => `x_{${index}}`).join("+");
  await open(page, `长公式：\n\n\\[${terms}\\]`);
  await page.getByRole("button", { name: "切换主题" }).click();
  const formula = page.locator(".katex-display");
  await expect(formula).toBeVisible();
  expect(await formula.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  const bounds = (await formula.boundingBox())!;
  const termsInFormula = formula.locator(".katex-html .base");
  expect((await termsInFormula.first().boundingBox())!.x).toBeGreaterThanOrEqual(bounds.x - 1);
  await formula.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  expect(await formula.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  const last = (await termsInFormula.last().boundingBox())!;
  expect(last.x + last.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(420);
  await expect(page.locator(".katex")).toHaveCSS("color", "rgb(230, 232, 235)");
  await page.getByLabel("消息", { exact: true }).fill("继续输入");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("继续输入");
  await page.screenshot({ path: info.outputPath("local-pc-math-narrow-dark.png"), animations: "disabled" });
});
