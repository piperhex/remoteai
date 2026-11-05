import { test, expect, type Page } from "@playwright/test";

test("a short conversation shows its question and full activity count immediately", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/desktop-history-harness.html?compact");
  const viewport = page.getByLabel("对话消息");
  const group = viewport.locator("summary");
  await expect(group).toHaveAttribute("aria-label", "处理过程，30 项活动");
  await expect(page.locator('[data-message-id="message-0"]')).toBeInViewport();
  await expect(page.locator('[data-message-id^="activity-"]')).toHaveCount(0);
  expect(await viewport.evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(0);
  await viewport.hover();
  await page.mouse.wheel(0, 200);
  await page.mouse.wheel(0, -200);
  await expect(page.locator('[data-message-id="message-0"]')).toBeInViewport();
  await expect(group).toHaveAttribute("aria-label", "处理过程，30 项活动");
  await expect(viewport.locator("details")).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: "加载更早的消息" })).toHaveCount(0);
  await expect(page.getByText("最新回复已完成。", { exact: true })).toBeInViewport();
  await page.screenshot({ path: "../../.codex-tmp/desktop-history-wheel.png", animations: "disabled" });
});

async function collapsedHistory(page: Page, height = 1200) {
  await page.setViewportSize({ width: 1440, height });
  await page.goto("/e2e/desktop-history-harness.html?activity-history");
  const viewport = page.getByLabel("对话消息");
  await expect(viewport.locator("summary")).toHaveText(Array(3).fill("处理过程"));
  await expect(page.locator("[data-message-id]")).toHaveCount(7);
  await expect(page.locator('[data-message-id="question-3"]')).toHaveCount(0);
  const anchor = viewport.locator('[data-turn-id="history-3"] summary');
  await anchor.evaluate((node) => { node.setAttribute("data-test-original", "true"); });
  return { viewport, anchor };
}

for (const trigger of ["wheel", "button"] as const) {
  test(`one ${trigger} reveals earlier messages across hundreds of collapsed activities`, async ({ page }) => {
    const { viewport, anchor } = await collapsedHistory(page);
    expect(await viewport.evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(0);
    if (trigger === "wheel") {
      await viewport.hover();
      await page.mouse.wheel(0, 200);
      await expect(page.locator("[data-message-id]")).toHaveCount(7);
      await page.mouse.wheel(0, -200);
    } else {
      await page.getByRole("button", { name: "加载更早的消息" }).click();
    }
    await expect(page.locator("[data-message-id]")).toHaveCount(14);
    await expect(page.locator('[data-message-id="question-3"]')).toBeInViewport();
    await expect(viewport.locator("summary")).toHaveText(Array(6).fill("处理过程"));
    await expect(viewport.locator("details[open]")).toHaveCount(0);
    await expect(page.locator('[data-message-id^="history-activity-"]')).toHaveCount(0);
    await expect(anchor).toHaveAttribute("data-test-original", "true");
    await expect(page.getByRole("button", { name: "加载更早的消息" })).toHaveCount(0);
  });
}

test("paging a scrollable activity history preserves its collapsed summary as the reading anchor", async ({ page }) => {
  const { viewport, anchor } = await collapsedHistory(page, 650);
  expect(await viewport.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
  await older(page, 14, "[data-history-anchor]");
  await expect(anchor).toHaveAttribute("data-test-original", "true");
  await expect(viewport.locator("summary")).toHaveText(Array(6).fill("处理过程"));
  await expect(viewport.locator("details[open]")).toHaveCount(0);
  await expect(page.locator('[data-message-id^="history-activity-"]')).toHaveCount(0);
});

async function older(page: Page, count: number, selector = "[data-message-id]") {
  const viewport = page.getByLabel("对话消息");
  // The scroll event captures the original anchor before the two-frame prepend.
  await viewport.evaluate((node, selector) => {
    node.querySelector("[data-test-anchor]")?.removeAttribute("data-test-anchor");
    const first = node.querySelector<HTMLElement>(selector)!;
    first.setAttribute("data-test-anchor", "true");
    node.addEventListener("scroll", () => {
      node.dataset.anchorTop = String(first.getBoundingClientRect().top);
    }, { once: true });
    const observer = new MutationObserver(() => {
      if (node.querySelector('[role="status"]')?.textContent?.includes("正在加载更早的消息")) {
        node.dataset.sawLoading = "true";
        observer.disconnect();
      }
    });
    observer.observe(node, { childList: true, subtree: true });
    node.scrollTop = 0;
  }, selector);
  await expect(page.locator("[data-message-id]")).toHaveCount(count);
  await expect(viewport).toHaveAttribute("data-saw-loading", "true");
  const shift = await viewport.evaluate((node) => {
    const anchor = node.querySelector("[data-test-anchor]")!;
    return anchor.getBoundingClientRect().top - Number(node.dataset.anchorTop);
  });
  expect(Math.abs(shift)).toBeLessThan(3);
}

test("a cached 2000-message conversation mounts ten at entry and preserves the anchor while paging", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/e2e/desktop-history-harness.html");
  await expect(page.locator("[data-message-id]")).toHaveCount(10);
  await expect(page.locator('[data-message-id="message-1999"]')).toBeInViewport();
  await older(page, 20);
  await older(page, 30);
  const user = await page.locator('[data-message-id="message-1980"] article').boundingBox();
  const reply = await page.locator('[data-message-id="message-1981"] article').boundingBox();
  expect(user!.x).toBeGreaterThan(reply!.x);
  await page.screenshot({ path: "../../.codex-tmp/desktop-history.png", animations: "disabled" });
  await page.getByRole("button", { name: "切换会话" }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(0);
  await page.getByRole("button", { name: "切换会话" }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(10);
  await expect(page.locator('[data-message-id="message-1999"]')).toBeInViewport();
  await older(page, 20);
  const readingAnchor = await page.locator('[data-message-id]').first().getAttribute('data-message-id');
  await page.getByRole("button", { name: "离开对话" }).click();
  await page.getByRole("button", { name: "返回对话" }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(20);
  await expect(page.locator('[data-message-id]').first()).toHaveAttribute('data-message-id', readingAnchor!);
});

test("streamed replies and typing stay live while browsing older components", async ({ page }) => {
  await page.goto("/e2e/desktop-history-harness.html");
  await expect(page.locator("[data-message-id]")).toHaveCount(10);
  await page.getByRole("button", { name: "开始回复" }).click();
  const live = page.locator('[data-message-id="live"]');
  await expect(live).toContainText("实时回复");
  const previous = await live.textContent();
  await older(page, 20);
  const before = Number(await page.getByLabel("刷新次数").textContent());
  await page.getByLabel("消息", { exact: true }).fill("加载历史时继续输入");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("加载历史时继续输入");
  // Offscreen message bodies are virtualized; verify the stream after returning to it.
  await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(before + 3);
  await expect(page.locator("[data-message-id]")).toHaveCount(20);
  await expect(page.getByRole("button", { name: "回到最新消息" })).toBeVisible();
  await page.getByRole("button", { name: "回到最新消息" }).click();
  await expect(live).toBeInViewport();
  await expect(live).toContainText('实时回复');
  await expect.poll(() => live.textContent()).not.toBe(previous);
});
