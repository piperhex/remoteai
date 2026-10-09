import { expect, test } from "@playwright/test";

test("quota charts support polling and navigation in development mode", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("codex-switch:language", "zh");
    localStorage.setItem("codex-switch:local-proxy-port", "8080");
    localStorage.setItem("codex-switch:local-proxy-running", "true");
    localStorage.setItem("codex-switch:token-usage-refresh-seconds", "1");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Token 汇总", exact: true }).click();
  const chart = page.locator('div[role="img"][aria-label^="官方账户额度趋势:"]').first();
  await expect(chart.locator("canvas").first()).toBeVisible();

  const updated = page.getByText(/最近 \d+ 周 · 更新于/).first();
  const previousUpdate = await updated.textContent();
  await expect(updated).not.toHaveText(previousUpdate ?? "");
  await page.getByText("剩余额度", { exact: true }).click();
  await expect(chart).toHaveAttribute("aria-label", /展示每次刷新的剩余额度/);
  await page.getByText("每 6 小时", { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("每小时", { exact: true }).click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "切换到暗黑主题", exact: true }).click();
  await expect(chart.locator("canvas").first()).toBeVisible();

  await page.getByRole("button", { name: "账户管理", exact: true }).click();
  await expect(page.getByRole("button", { name: "工具箱", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Token 汇总", exact: true }).click();
  await expect(chart.locator("canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});
