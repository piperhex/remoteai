import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { join } from 'node:path';
import { composerUsageOverlay, usageStatuslineScript as script } from "./fixtures/usage-statusline-source.mjs";
import { testBrowserLaunchOptions } from './test-browser.mjs';

let browser;
before(async () => { browser = await chromium.launch(testBrowserLaunchOptions({ headless: true })); });
after(async () => { await browser?.close(); });

async function setup(page, dark) {
  await page.setContent(`<style>
    body { margin:24px; font:14px system-ui; background:${dark ? "#171819" : "#fff"};
      color:${dark ? "#eee" : "#222"}; --text-primary:${dark ? "#eee" : "#222"};
      --text-secondary:${dark ? "#c4c4c7" : "#5d5d62"};
      --text-tertiary:${dark ? "#a8aaaf" : "#6b7279"}; }
    [data-codex-composer-root] { max-width:780px; margin:auto; }
    [data-composer-surface-variant] { padding:16px; border:1px solid ${dark ? "#46474a" : "#d8dade"};
      border-radius:22px; background:${dark ? "#303134" : "#f5f6f8"}; }
    [contenteditable] { min-height:50px; opacity:.6; outline:none; }
    #toolbar { display:flex; justify-content:space-between; align-items:center; color:var(--text-primary); }
    .csw-context-button svg { width:16px; height:16px; color:var(--text-tertiary); fill:none;
      stroke:currentColor; stroke-width:2; stroke-linecap:butt; }
  </style><main data-codex-composer-root data-composer-placement="thread">
    <div data-above-composer-conversation-id="local:fixture"></div>
    <div data-composer-surface-variant="default"><div contenteditable="true">与 Codex 协作</div>
    <div id="toolbar"><span>＋</span><span class="csw-context-button"><svg viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="6" opacity=".2"/><circle cx="8" cy="8" r="6" pathLength="100"
    stroke-dasharray="29.1 100" transform="rotate(-90 8 8)"/></svg></span>
    <span>GPT-6.1-Sol　 ▴</span></div></div></main>`);
  await page.evaluate(() => {
    window.fixtureNow = 1000;
    Date.now = () => window.fixtureNow;
    window.fixtureConversation = { resumeState: "resumed", threadRuntimeStatus: { type: "active" },
      latestTokenUsageInfo: { total: { outputTokens: 100, inputTokens: 1000, cachedInputTokens: 999 },
        last: { inputTokens: 1000, cachedInputTokens: 999, totalTokens: 1900 }, modelContextWindow: 10000 } };
    const manager = { getConversation: id => id === "local:fixture" ? window.fixtureConversation : null };
    const registry = { getImplForHostId: () => manager, addRegistryCallback() {} };
    window.__codexRoot = { _internalRoot: { current: { memoizedProps: { value: registry } } } };
    window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = true;
    window.__CODEX_SWITCH_SPEED_SELECTOR__ = { installed: true, language: "zh", usage: { enabled: true } };
    window.codexSwitchRequestConversationMetrics = payload => {
      const request = JSON.parse(payload);
      window.__CODEX_SWITCH_USAGE_STATUSLINE__.receiveTiming(request.conversationId, request.requestId,
        { totalOutputTokens: 102, totalOutputTimeMs: 2000, outputRequestCount: 1 });
    };
  });
  await page.evaluate(script);
  await expect(page.locator("[data-codex-switch-usage-statusline]")).toContainText("99.9%");
  await page.evaluate(async () => {
    window.fixtureNow = 3000;
    window.fixtureConversation.latestTokenUsageInfo.total.outputTokens = 202;
    await window.__CODEX_SWITCH_USAGE_STATUSLINE__.refresh();
  });
}

for (const dark of [false, true]) {
  test(`statusline follows the composer and fits a narrow ${dark ? "dark" : "light"} window`, async () => {
    const page = await browser.newPage({ viewport: { width: 860, height: 210 }, deviceScaleFactor: 2 });
    try {
      await setup(page, dark);
      const bar = page.getByRole("status", { name: "会话用量统计" });
      await expect(bar).toHaveText("51.0 tok/s缓存命中 99.9%19.0%");
      const card = await page.locator("[data-composer-surface-variant]").boundingBox();
      const box = await bar.boundingBox();
      assert.ok(box.y >= card.y + card.height, "bar must be outside and below the input card");
      const appearance = await bar.evaluate(element => {
        const style = getComputedStyle(element);
        const modelStyle = getComputedStyle(document.querySelector("#toolbar > span:last-child"));
        const iconStyle = getComputedStyle(element.querySelector("svg"));
        const ringStyle = getComputedStyle(element.querySelector('[data-usage-metric="2"] svg'));
        const upperRing = getComputedStyle(document.querySelector(".csw-context-button svg"));
        const ringAppearance = value => [value.width, value.height, value.color, value.strokeWidth, value.strokeLinecap];
        return { color: style.color, modelColor: modelStyle.color, font: style.fontSize,
          iconWidth: iconStyle.width, iconHeight: iconStyle.height,
          ring: ringAppearance(ringStyle), upperRing: ringAppearance(upperRing) };
      });
      assert.equal(appearance.color, dark ? "rgb(196, 196, 199)" : "rgb(93, 93, 98)");
      assert.notEqual(appearance.color, appearance.modelColor, "statistics use the softer secondary text color");
      assert.equal(appearance.font, "13px");
      assert.equal(appearance.iconWidth, "14px");
      assert.equal(appearance.iconHeight, "14px");
      assert.equal(appearance.ring[0], "14px");
      assert.equal(appearance.ring[1], "14px");
      assert.equal(appearance.ring[2], appearance.upperRing[2], "keep the upper ring's color");
      assert.equal(appearance.ring[3], "1.4px");
      await page.evaluate(async () => {
        window.fixtureConversation.latestTokenUsageInfo.last.totalTokens = 2910;
        await window.__CODEX_SWITCH_USAGE_STATUSLINE__.refresh();
      });
      await expect(bar).toHaveText("51.0 tok/s缓存命中 99.9%29.1%");
      await expect(bar.locator("[data-context-progress]")).toHaveAttribute("stroke-dasharray", "29.1 100");
      if (dark && process.env.CODEX_USAGE_STATUSLINE_SCREENSHOT) {
        await page.screenshot({ path: process.env.CODEX_USAGE_STATUSLINE_SCREENSHOT });
      }
      if (!dark && process.env.CODEX_USAGE_STATUSLINE_LIGHT_SCREENSHOT) {
        await page.screenshot({ path: process.env.CODEX_USAGE_STATUSLINE_LIGHT_SCREENSHOT });
      }
      await page.setViewportSize({ width: 350, height: 260 });
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert.equal(fits, true);
      await page.evaluate(() => { window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = false; });
      await expect(bar).toBeHidden();
    } finally { await page.close(); }
  });
}

test('current Codex host subscriptions restore metrics without the legacy registry and follow new chats', async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 300 } });
  try {
    await page.route('http://codex-fixture.test/**', route => {
      const isModule = route.request().url().endsWith('/assets/app-shared-fixture.js');
      return route.fulfill({ contentType: isModule ? 'text/javascript' : 'text/html',
        body: isModule ? `
          const resource = () => ({ [Symbol.dispose]() {} });
          export const services = { appServerManagers: {
            openAccount() { throw new Error('Account access is not needed for usage'); },
            subscribe(hostId, listener) {
              if (hostId !== 'local') throw new Error('Unexpected host');
              queueMicrotask(() => listener({ status: 'ready', manager: { dup() {
                return { ...resource(), subscribe(options) {
                  if (options.field !== 'tokenUsageInfo') throw new Error('Unexpected subscription');
                  window.fixtureUsageSubscriptions ??= [];
                  window.fixtureUsageSubscriptions.push(options);
                  queueMicrotask(() => options.listener(window.fixtureNativeUsage));
                  return resource();
                } };
              } } }));
              return resource();
            }
          } };
        ` : '<!doctype html><title>Native usage fixture</title>' });
    });
    await page.goto('http://codex-fixture.test/');
    await setup(page, false);
    await page.evaluate(() => {
      window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
      delete window.__codexRoot;
      window.fixtureNativeUsage = { total: { inputTokens: 1000, cachedInputTokens: 650 },
        last: { totalTokens: 2050 }, modelContextWindow: 10000 };
      const preload = document.createElement('link');
      preload.rel = 'modulepreload'; preload.href = '/assets/app-shared-fixture.js'; document.head.append(preload);
    });
    await page.evaluate(script);
    const bar = page.getByRole('status', { name: '会话用量统计' });
    await expect(bar).toHaveText('51.0 tok/s缓存命中 65.0%20.5%');
    await page.evaluate(() => {
      document.querySelector('[data-above-composer-conversation-id]')
        .setAttribute('data-above-composer-conversation-id', 'local:second');
      window.fixtureNativeUsage = null;
    });
    await expect(bar).toHaveText('51.0 tok/s缓存命中 ——');
    await page.evaluate(() => {
      const subscription = window.fixtureUsageSubscriptions.at(-1);
      subscription.listener({ total: { inputTokens: 100, cachedInputTokens: 80 },
        last: { totalTokens: 3200 }, modelContextWindow: 10000 });
    });
    await expect(bar).toHaveText('51.0 tok/s缓存命中 80.0%32.0%');
    await page.locator('[contenteditable]').fill('The composer remains responsive');
    await expect(page.locator('[contenteditable]')).toHaveText('The composer remains responsive');
    await page.evaluate(() => window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose());
    await expect(bar).toHaveCount(0);
  } finally { await page.close(); }
});

test("Japanese and usage toggles stay responsive while conversation timings are pending", async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 320 } });
  try {
    await setup(page, true);
    await page.evaluate(() => { window.codexSwitchRequestConversationMetrics = () => {}; });
    await page.evaluate(composerUsageOverlay);
    await page.evaluate(() => {
      const owner = window.__CODEX_SWITCH_SPEED_SELECTOR__;
      owner.updateLanguage("ja");
      owner.updateUsage({ enabled: true });
    });
    const bar = page.getByRole("status", { name: "会話の使用状況" });
    await expect(bar).toContainText("キャッシュ命中率 99.9%");
    await expect(bar).toContainText("— tok/s");
    await page.locator("[contenteditable]").fill("入力中のメッセージ");
    await expect(page.locator("[contenteditable]")).toHaveText("入力中のメッセージ");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.CODEX_USAGE_STATUSLINE_JAPANESE_SCREENSHOT) {
      await page.screenshot({ path: process.env.CODEX_USAGE_STATUSLINE_JAPANESE_SCREENSHOT });
    }
    await page.evaluate(() => window.__CODEX_SWITCH_SPEED_SELECTOR__.updateUsage({ enabled: false }));
    await expect(bar).toBeVisible();
    await expect(bar.locator('[data-usage-metric]')).toHaveCount(3);
    await expect(page.locator('[data-today-usage]')).toBeHidden();
    assert.equal(await page.evaluate(() => window.__CODEX_SWITCH_USAGE_STATUSLINE__ !== undefined), true);
    await page.evaluate(() => window.__CODEX_SWITCH_SPEED_SELECTOR__.updateUsage({ enabled: true }));
    await expect(bar).toHaveCount(1);
    await expect(page.locator("[contenteditable]")).toHaveText("入力中のメッセージ");
    await page.evaluate(() => {
      window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = false;
      window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
    });
    await expect(bar).toHaveCount(0);
    await page.evaluate(composerUsageOverlay);
    assert.equal(await page.evaluate(() => window.__CODEX_SWITCH_USAGE_STATUSLINE__ === undefined), true);
  } finally { await page.close(); }
});

for (const dark of [false, true]) {
  test(`daily usage follows all three metrics and hides in narrow ${dark ? 'dark' : 'light'} composers`, async () => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 280 } });
    try {
      await setup(page, dark);
      await page.locator('#toolbar > span:last-child').evaluate(node => {
        node.innerHTML = '<span><button data-composer-navigation-target="reasoning">GPT-6-Astra</button></span>';
      });
      await page.evaluate(composerUsageOverlay);
      await page.evaluate(() => window.__CODEX_SWITCH_SPEED_SELECTOR__.updateUsage({
        enabled: true, totalTokens: 19060000, estimatedCostUsd: 28.2, primaryRemainingPercent: 97,
      }));
      const daily = page.locator('[data-today-usage]');
      const metrics = page.locator('[data-usage-metric]');
      await expect(daily).toBeVisible();
      await expect(daily).toHaveText('今日19.06M·28.2 USD·97%');
      await expect(page.locator('#toolbar [data-today-usage]')).toHaveCount(0);
      await page.evaluate(() => window.__CODEX_SWITCH_SPEED_SELECTOR__.updateUsage({ enabled: false }));
      await expect(daily).toBeHidden();
      for (const metric of await metrics.all()) await expect(metric).toBeVisible();
      await expect(metrics.nth(0)).toHaveText('51.0 tok/s');
      await expect(metrics.nth(1)).toHaveText('缓存命中 99.9%');
      await expect(metrics.nth(2)).toHaveText('19.0%');
      await page.evaluate(() => window.__CODEX_SWITCH_SPEED_SELECTOR__.updateUsage({
        enabled: true, totalTokens: 19060000, estimatedCostUsd: 28.2, primaryRemainingPercent: 97,
      }));
      await expect(daily).toBeVisible();
      const checkFits = async () => {
        const last = await metrics.last().boundingBox();
        const box = await daily.boundingBox();
        assert.ok(box.x >= last.x + last.width && Math.abs(box.y - last.y) < 3);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      };
      await checkFits();
      const directory = process.env.CODEX_USAGE_FOOTER_SCREENSHOT_DIR;
      if (directory) await page.screenshot({ path: join(directory, `native-${dark ? 'dark' : 'light'}-wide.png`) });
      await page.setViewportSize({ width: 720, height: 280 });
      await expect(daily).toBeHidden();
      for (const metric of await metrics.all()) await expect(metric).toBeVisible();
      if (directory) await page.screenshot({ path: join(directory, `native-${dark ? 'dark' : 'light'}-narrow.png`) });
      await page.setViewportSize({ width: 1280, height: 280 });
      await page.locator('main').evaluate(node => { node.style.maxWidth = '560px'; });
      await expect(daily).toBeHidden();
      await page.locator('main').evaluate(node => { node.style.maxWidth = '780px'; });
      await expect(daily).toBeVisible();
      for (const language of ['ru', 'ja', 'en']) {
        await page.evaluate(language => window.__CODEX_SWITCH_SPEED_SELECTOR__.updateLanguage(language), language);
        await checkFits();
      }
      await page.evaluate(composerUsageOverlay);
      await expect(daily).toHaveCount(1);
      await expect(page.locator('[data-codex-switch-usage-statusline] > [data-today-usage]:last-child')).toHaveCount(1);
    } finally { await page.close(); }
  });
}
