import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";

const source = await readFile(new URL(
  "../apps/desktop/src-tauri/src/dream_skin_native/speed_selector_overlay.rs", import.meta.url), "utf8");
const overlay = source.slice(source.indexOf('r#"') + 3, source.lastIndexOf('"#;'));
const expression = (tier = "default") => overlay.replace("__CODEX_SWITCH_SERVICE_TIER__", JSON.stringify(tier));
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function setup(page, dark = false) {
  await page.setContent(`<style>
    body { font: 14px system-ui; margin: 16px; background: ${dark ? "#202522" : "#fff"};
      color: ${dark ? "#eee" : "#222"}; --text-tertiary: ${dark ? "#abb8b0" : "#718078"}; }
    #composer { margin-top: 100px; border: 1px solid #aaa; padding: 12px; border-radius: 16px; }
    #toolbar { display: flex; align-items: center; justify-content: flex-end; }
    [contenteditable] { min-height: 48px; }
  </style><div id="composer"><div contenteditable="true" aria-label="Message">Draft</div>
    <div id="toolbar"><div><div><button data-composer-navigation-target="reasoning">GPT-6-Astra</button>
    </div></div></div></div>`);
  await page.evaluate(() => {
    window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = true;
    window.__CODEX_SWITCH_FAST_MODE_ALLOWED__ = true;
    window.speedCalls = [];
    window.usageCalls = 0;
    window.codexSwitchSetServiceTier = tier => window.speedCalls.push(tier);
    window.codexSwitchRequestUsageSummary = () => { window.usageCalls += 1; };
  });
  await page.evaluate(expression());
  await page.evaluate(() => window.__CODEX_SWITCH_SPEED_SELECTOR__.updateUsage({
    enabled: true, totalTokens: 1234, estimatedCostUsd: 7.5, primaryRemainingPercent: 98,
  }));
}

test("renders the GUI lightning states and stays responsive during pending speed and usage requests", async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 400 } });
  try {
    await setup(page);
    const speed = page.locator("[data-speed-button]");
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.locator("[data-speed-label]")).toHaveCount(0);
    await expect(speed).toHaveAttribute("data-speed", "normal");
    for (const [tier, mode, bolts, key] of [
      ["priority", "fast", 1, "Space"], ["ultrafast", "ultrafast", 2, "Enter"],
      ["default", "normal", 0, null],
    ]) {
      if (key) { await speed.focus(); await speed.press(key); }
      else await speed.click();
      await expect(speed).toHaveAttribute("data-speed", mode);
      await expect(speed).toHaveAttribute("aria-busy", "true");
      await expect(speed).toBeDisabled();
      await expect(speed.locator(".is-lit")).toHaveCount(bolts);
      await page.locator("[contenteditable]").fill(`Draft in ${mode}`);
      assert.equal(await page.locator("[contenteditable]").textContent(), `Draft in ${mode}`);
      const requests = await page.evaluate(() => {
        const state = window.__CODEX_SWITCH_SPEED_SELECTOR__;
        state.requestUsage();
        const count = window.usageCalls;
        for (let index = 0; index < 5; index += 1) state.requestUsage();
        return [count, window.usageCalls];
      });
      assert.equal(requests[0], requests[1]);
      await page.evaluate(tier => window.__CODEX_SWITCH_SPEED_SELECTOR__.completeSelection(tier, true), tier);
      await expect(speed).toBeEnabled();
    }
    assert.deepEqual(await page.evaluate(() => window.speedCalls), ["priority", "ultrafast", "default"]);
    await expect(page.locator("[data-today-tokens]")).toHaveText("1.2K");
  } finally { await page.close(); }
});

test("restores Ultrafast on refresh and remount, with compact localized tooltips in both palettes", async () => {
  for (const dark of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 420, height: 400 } });
    try {
      await setup(page, dark);
      await page.evaluate(expression("ultrafast"));
      await page.evaluate(() => window.__CODEX_SWITCH_SPEED_SELECTOR__.updateLanguage("ru"));
      const speed = page.locator("[data-speed-button]");
      await expect(speed).toHaveAttribute("data-speed", "ultrafast");
      await expect(speed.locator(".is-lit")).toHaveCount(2);
      await speed.hover();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText("Сверхбыстрый режим");
      const bounds = await tooltip.boundingBox();
      assert.ok(bounds.width <= 400);
      assert.ok(bounds.x >= 8);
      assert.equal(await speed.locator("path").first().getAttribute("fill"), "#9560ed");
      await page.evaluate(() => document.querySelector("[data-codex-switch-speed-selector]").remove());
      await expect(speed).toHaveCount(1);
      await expect(speed).toHaveAttribute("data-speed", "ultrafast");
      await expect(speed.locator(".is-lit")).toHaveCount(2);
      await page.evaluate(() => {
        window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = false;
        window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
      });
      await expect(speed).toHaveCount(0);
    } finally { await page.close(); }
  }
});
