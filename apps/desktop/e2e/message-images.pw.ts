import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Conversation } from "../../../shared/conversation/types";

const source = (process.env.CHAT_TEST_SCREENSHOT ?? "C:/screenshots/tool-capture.png").replace(/\\/g, "/");
const markdownSource = /^[a-z]:\//i.test(source) ? "/" + source : source;
const screenshot = readFileSync(process.env.CHAT_TEST_SCREENSHOT ?? "src-tauri/icons/32x32.png");
const url = "data:image/png;base64," + screenshot.toString("base64");
const fixture: Conversation = { thread: { id: "images", cwd: "", preview: "", updatedAt: 1 },
  activeTurn: null, tokens: 0, error: "", turns: [{ id: "turn", status: "completed", items: [
    { id: "answer", type: "agentMessage", phase: "final_answer", text: "![截图](" + markdownSource + ")" },
  ] }] };

test("local screenshot loads after reload and opens in the full-size viewer", async ({ page }) => {
  await page.route("**/e2e/tool-history-harness.html", async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace("<head>",
      '<head><meta name="codex-switch-runtime" content="hosted">');
    await route.fulfill({ response, body: html });
  });
  await page.route("**/history-fixture.json", (route) => route.fulfill({ json: fixture }));
  let requests = 0;
  await page.route("**/__codex_switch__/api/invoke", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ command: "codex_gui_request",
      args: { request: { operation: "imagePreview", threadId: "images", source,
        variant: requests < 2 ? "thumbnail" : "original" } } });
    requests++;
    await route.fulfill({ json: requests === 1 ? { ok: false, error: "unavailable" }
      : { ok: true, result: { data: { url } } } });
  });
  await page.goto("/e2e/tool-history-harness.html");
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole("button", { name: `预览文件：${source}`, exact: true })).toBeVisible();
  await page.reload();
  const thumbnail = page.getByRole("button", { name: "放大查看：截图", exact: true });
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.locator("img").evaluate((img: HTMLImageElement) =>
    img.complete && img.naturalWidth > 0)).toBe(true);
  await thumbnail.click();
  const viewer = page.getByRole("dialog", { name: "截图", exact: true });
  await expect(viewer).toBeVisible();
  await expect.poll(() => viewer.locator("img").evaluate((img: HTMLImageElement) =>
    img.complete && img.naturalWidth > 0)).toBe(true);
  // Local previews load the original on opening; only remote viewers require an explicit request.
  await expect.poll(() => requests).toBe(3);
  await page.screenshot({ path: "../../.codex-tmp/local-image-preview.png", animations: "disabled" });
  await page.getByRole("button", { name: "关闭图片", exact: true }).click();
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeVisible();
});
