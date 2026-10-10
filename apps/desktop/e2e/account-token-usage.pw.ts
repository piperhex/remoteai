import { expect, test } from "@playwright/test";

for (const running of [true, false]) {
  test(`account cards and table show recorded usage with proxy running=${running}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((running) => {
      localStorage.setItem("codex-switch:language", "zh");
      localStorage.setItem("codex-switch:account-display-mode", "cards");
      localStorage.setItem("codex-switch:local-proxy-port", "8080");
      localStorage.setItem("codex-switch:local-proxy-running", String(running));
    }, running);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "账户管理", exact: true }).click();
    const cards = page.locator(".account-card");
    const first = cards.first();
    await expect(first.locator(".account-card-token-summary")).toHaveText("今日消耗 85.8K Tokens");
    await expect(first.locator(".account-card-token-cost")).not.toHaveText("0.00 USD");
    const cost = await first.locator(".account-card-token-cost").textContent();
    await expect(cards.nth(1).locator(".account-card-token-summary")).toHaveText("今日消耗 0 Tokens");
    for (const width of [1440, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(first.locator(".account-card-token-summary")).toBeInViewport();
      await expect(first.locator(".account-card-token-cost")).toBeInViewport();
      await page.screenshot({ path: `../../.codex-tmp/account-usage-${running}-${width}.png` });
    }
    await page.getByRole("button", { name: "切换到暗黑主题", exact: true }).click();
    for (const width of [1440, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(first.locator(".account-card-token-summary")).toBeInViewport();
      await page.screenshot({ path: `../../.codex-tmp/account-usage-dark-${running}-${width}.png`,
        animations: "disabled" });
    }
    await page.getByRole("button", { name: "工具箱", exact: true }).click();
    await page.getByRole("tab", { name: "表格", exact: true }).click();
    await expect(page.locator(".compact-model-token-chart").first()).toHaveAttribute(
      "aria-label", "今日 Token 用量: 85.8K",
    );
    await expect(page.locator(".account-token-cost").first()).toHaveText(cost ?? "");
    expect(errors).toEqual([]);
  });
}
