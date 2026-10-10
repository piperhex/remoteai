import { after, before, test } from "node:test";
import { buildSync } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { contextOverlay } from "./fixtures/context-usage-overlay.mjs";

const script = buildSync({
  stdin: { contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { flushSync } from "react-dom";
    const Indicator = React.memo(({ contextUsage }) => contextUsage.usedTokens == null ? null :
      <span role="img" aria-label={"Context usage: " + contextUsage.usedTokens}>◉</span>);
    const Model = ({ conversationId }) => <button>{conversationId}</button>;
    const root = createRoot(document.getElementById("root"));
    let usage = { usedTokens: 30260, contextWindow: 258400 };
    window.renderContext = (used, tick = 0) => {
      if (used !== null) usage = { ...usage, usedTokens: used };
      flushSync(() => root.render(<div data-codex-composer-root><span>{tick}</span>
        <span><Indicator contextUsage={usage} /></span><Model conversationId="one" /><input aria-label="Message" />
      </div>));
    };
    window.renderContext(30260);
    window.emptyContext = () => { usage = { usedTokens: null, contextWindow: null }; window.renderContext(null); };
  `, loader: "jsx", resolveDir: process.cwd() },
  bundle: true, write: false, format: "iife", define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test("tracks React commits and memoized descendants without reverting to native controls", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root" style="margin:120px"></div>');
    await page.evaluate(script);
    await page.evaluate(contextOverlay());
    const button = page.getByRole("button", { name: "查看上下文用量" });
    const panel = page.locator(".csw-context-popover");
    await button.click();
    for (let index = 0; index < 4; index += 1) {
      await page.evaluate(index => {
        window.renderContext(index % 2 ? null : 10000 + index, index);
        window.__CODEX_SWITCH_CONTEXT_USAGE__.refresh();
      }, index);
      await expect(button).toHaveCount(1);
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("已用 10K Token");
    }
    await page.evaluate(() => window.renderContext(150000));
    await expect(panel).toContainText("58% 已用（剩余 42%）");
    await page.evaluate(contextOverlay(false));
    await expect(page.getByRole("img")).toBeVisible();
    await expect(button).toHaveCount(0);
  } finally { await page.close(); }
});

test("shows the settings entry before native usage exists and replaces it once the native ring appears", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root" style="margin:120px"></div>');
    await page.evaluate(script);
    await page.evaluate(() => window.emptyContext());
    await page.evaluate(contextOverlay());
    const button = page.getByRole("button", { name: "查看上下文用量" });
    await button.click();
    await expect(page.locator(".csw-context-popover")).toContainText("暂无上下文用量");
    await expect(page.getByRole("button", { name: "当前对话容量设置" })).toBeEnabled();
    await page.evaluate(() => window.renderContext(500));
    await expect(button).toHaveCount(1);
    await page.evaluate(contextOverlay(false));
    await expect(page.getByRole("img")).toBeVisible();
    await expect(button).toHaveCount(0);
  } finally { await page.close(); }
});
