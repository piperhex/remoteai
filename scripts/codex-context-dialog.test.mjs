import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { contextOverlay, setContext, setupContext } from "./fixtures/context-usage-overlay.mjs";

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function setup(page, dark = false) {
  await page.route("http://context.test/", route => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
  await page.goto("http://context.test/");
  await setupContext(page, { dark });
  await page.evaluate(contextOverlay(false));
  await page.evaluate(() => {
    window.contextCalls = [];
    window.manager = {
      getConversation: id => ["one", "two"].includes(id) ? { id } : null,
      updateConversationState: (id, update) => update({ id }),
      resumeConversation: async ({ conversationId }) => {
        await window.manager.requestClient.sendRequest("thread/resume", { threadId: conversationId });
        return { status: "ready" };
      },
      requestClient: { sendRequest: async (method, params) => {
        window.contextCalls.push({ method, params });
        if (method === "thread/unsubscribe" && window.delayContextSave) await new Promise(resolve => {
          window.finishContextSave = resolve;
        });
        return { thread: { id: params.threadId, status: { type: "idle" } }, model: "provider-model",
          reasoningEffort: "high", approvalPolicy: "on-request", sandbox: { type: "readOnly", networkAccess: false } };
      } },
    };
    const registry = { getImplForHostId: host => host === "local" ? window.manager : null, addRegistryCallback() {} };
    // The native React compiler stores its manager registry in the hook's memo cache.
    window.__codexRoot = { _internalRoot: { current: {
      updateQueue: { memoCache: { data: [[null, registry]] } },
    } } };
  });
  await page.evaluate(contextOverlay());
}

async function openSettings(page) {
  await page.getByRole("button", { name: "查看上下文用量" }).click();
  await page.getByRole("button", { name: "当前对话容量设置" }).click();
  await expect(page.getByLabel("上下文容量（K Token）")).toBeVisible();
}

test("edits native conversation capacity with GUI presets, validation, default and saved-capacity hint", async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 620 } });
  try {
    await setup(page);
    await openSettings(page);
    assert.deepEqual(await page.locator("datalist option").evaluateAll(options => options.map(option => option.value)),
      ["128", "272", "384", "400", "1000"]);
    const input = page.getByLabel("上下文容量（K Token）");
    await input.fill("0");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("1 到 100000");
    assert.equal(await page.evaluate(() => window.contextCalls.length), 0);
    await input.fill("384.125");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal(await page.evaluate(() => localStorage.getItem("codex-switch.context-capacity.v1:one")), "384125");
    await page.getByRole("button", { name: "查看上下文用量" }).click();
    await expect(page.locator(".csw-context-popover")).toContainText("对话设置：384.1K Token");
    await page.getByRole("button", { name: "当前对话容量设置" }).click();
    await expect(input).toHaveValue("384.125");
    await page.getByRole("button", { name: "恢复默认" }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal(await page.evaluate(() => localStorage.getItem("codex-switch.context-capacity.v1:one")), null);
  } finally { await page.close(); }
});

test("keeps settings bounded and responsive while saving, closes stale dialogs when switching conversations", async () => {
  for (const dark of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 360, height: 620 } });
    try {
      await setup(page, dark);
      await openSettings(page);
      await page.getByLabel("上下文容量（K Token）").fill("400");
      await mkdir(".codex-tmp/chatgpt-context", { recursive: true });
      await page.screenshot({ path: `.codex-tmp/chatgpt-context/settings-${dark ? "dark" : "light"}.png` });
      const box = await page.getByRole("dialog").boundingBox();
      assert.ok(box.width <= 360 && box.x >= 0 && box.x + box.width <= 360);
      await page.evaluate(() => { window.delayContextSave = true; });
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page.getByRole("button", { name: "正在保存…" })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeVisible();
      assert.equal(await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(true)))), true);
      await page.waitForFunction(() => window.finishContextSave);
      await page.evaluate(() => window.finishContextSave());
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openSettings(page);
      await setContext(page, { thread: "two" });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openSettings(page);
      await expect(page.getByLabel("上下文容量（K Token）")).toHaveValue("");
      await page.evaluate(contextOverlay(false));
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("#native")).toBeVisible();
    } finally { await page.close(); }
  }
});
