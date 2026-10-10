import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { contextOverlay, setContext, setupContext } from "./fixtures/context-usage-overlay.mjs";

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
const button = page => page.getByRole("button", { name: "查看上下文用量" });
const popover = page => page.locator(".csw-context-popover");

test("replaces native usage with GUI precision and click behavior, following committed React updates", async () => {
  const page = await browser.newPage();
  try {
    await setupContext(page);
    await expect(page.locator("#native")).toBeHidden();
    await button(page).hover();
    await expect(popover(page)).toBeHidden();
    await button(page).click();
    await expect(popover(page)).toHaveText("背景信息窗口12% 已用（剩余 88%）已用 30.3K Token，共 258.4K");
    await setContext(page, { used: 200_000, alternate: true });
    await expect(popover(page)).toContainText("77% 已用（剩余 23%）");
    await expect(popover(page)).toContainText("已用 200K Token");
    await button(page).press("Escape");
    await expect(popover(page)).toBeHidden();
    await expect(button(page)).toBeFocused();
    await button(page).press("Space");
    await expect(popover(page)).toBeVisible();
    await button(page).press("Enter");
    await expect(popover(page)).toBeHidden();
    await button(page).click();
    await page.locator('[contenteditable]').click();
    await expect(popover(page)).toBeHidden();
  } finally { await page.close(); }
});

test("closes on conversation changes, cleans up and restores native controls outside proxy mode", async () => {
  const page = await browser.newPage();
  try {
    await setupContext(page);
    await button(page).click();
    await setContext(page, { used: 0, thread: "two" });
    await expect(popover(page)).toBeHidden();
    await button(page).click();
    await expect(popover(page)).toContainText("0% 已用（剩余 100%）");
    await page.evaluate(() => document.getElementById("native").remove());
    await expect(button(page)).toHaveCount(0);
    await expect(popover(page)).toHaveCount(0);
    await setupContext(page);
    await page.evaluate(contextOverlay());
    await expect(button(page)).toHaveCount(1);
    await page.evaluate(contextOverlay(false));
    await expect(button(page)).toHaveCount(0);
    await expect(page.locator("#native")).toBeVisible();
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => window.__CODEX_SWITCH_CONTEXT_USAGE__), undefined);
    await expect(button(page)).toHaveCount(0);
  } finally { await page.close(); }
});

test("preserves unsupported native markup and hides native tooltips only while installed", async () => {
  const page = await browser.newPage();
  try {
    await setupContext(page);
    await page.evaluate(() => {
      const tooltip = document.createElement("div");
      tooltip.dataset.radixPopperContentWrapper = "";
      tooltip.id = "old-tooltip";
      tooltip.textContent = "原生提示";
      const description = document.createElement("span");
      description.id = "old-description";
      description.hidden = true;
      tooltip.append(description);
      document.body.append(tooltip);
      document.getElementById("native").setAttribute("aria-describedby", description.id);
    });
    await expect(page.locator("#old-tooltip")).toBeHidden();
    await page.evaluate(contextOverlay(false));
    await expect(page.locator("#old-tooltip")).toBeVisible();
    await page.evaluate(() => { delete document.getElementById("native").__reactFiber$fixture; });
    await page.evaluate(contextOverlay());
    await expect(button(page)).toHaveCount(0);
    await expect(page.locator("#native")).toBeVisible();
  } finally { await page.close(); }
});

test("handles unknown capacity, zero and over-capacity usage without invalid percentages", async () => {
  const page = await browser.newPage();
  try {
    await setupContext(page);
    await button(page).click();
    for (const [used, capacity, expected] of [
      [0, 100_000, "0% 已用（剩余 100%）"], [1234, null, "上下文容量未知"],
      [1234, 0, "上下文容量未知"], [-1, 100_000, "暂无上下文用量"],
      [NaN, 100_000, "暂无上下文用量"], [300_000, 258_400, "100% 已用（剩余 0%）"],
      [1_250_000, 2_000_000, "已用 1.25M Token，共 2M"],
    ]) {
      await setContext(page, { used, capacity });
      await expect(popover(page)).toContainText(expected);
      await expect(popover(page)).not.toContainText("NaN");
    }
  } finally { await page.close(); }
});

test("fits both viewport edges in light and dark mode, stays responsive during pending usage requests", async () => {
  await mkdir(new URL("../.codex-tmp/chatgpt-context/", import.meta.url), { recursive: true });
  for (const dark of [false, true]) {
    for (const edge of ["left", "right"]) {
      const page = await browser.newPage({ viewport: { width: 360, height: 440 } });
      try {
        await setupContext(page, { dark, edge });
        await page.evaluate(() => {
          window.__CODEX_SWITCH_SPEED_SELECTOR__ = { language: "zh", usagePending: true };
        });
        await button(page).click();
        await expect(popover(page)).toHaveAttribute("data-dark", String(dark));
        const box = await popover(page).boundingBox();
        assert.ok(box.width <= 400 && box.x >= 12 && box.x + box.width <= 348);
        await page.screenshot({ path: `.codex-tmp/chatgpt-context/${dark ? "dark" : "light"}-${edge}.png` });
        await page.locator('[contenteditable]').fill("Typing while usage is pending");
        await expect(page.locator('[contenteditable]')).toHaveText("Typing while usage is pending");
        await expect(popover(page)).toBeVisible();
        await page.evaluate(() => { window.__CODEX_SWITCH_SPEED_SELECTOR__.language = "ru"; });
        await expect(popover(page)).toContainText("Контекстное окно");
        const localized = await popover(page).boundingBox();
        assert.ok(localized.width <= 336 && localized.x >= 12 && localized.x + localized.width <= 348);
      } finally { await page.close(); }
    }
  }
});

test("updates theme in place and does not schedule a rendering loop while the composer is idle", async () => {
  const page = await browser.newPage();
  try {
    await setupContext(page);
    await button(page).click();
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = 'body.dark { color:#eee; --text-tertiary:#abb8b0; --text-primary:#eee; }';
      document.head.append(style);
      document.body.classList.add("dark");
      window.frameRequests = 0;
      const request = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => { window.frameRequests += 1; return request(callback); };
    });
    await expect(popover(page)).toHaveAttribute("data-dark", "true");
    await page.waitForTimeout(1200);
    assert.ok(await page.evaluate(() => window.frameRequests < 8));
    await page.evaluate(() => document.body.classList.remove("dark"));
    await expect(popover(page)).toHaveAttribute("data-dark", "false");
  } finally { await page.close(); }
});
