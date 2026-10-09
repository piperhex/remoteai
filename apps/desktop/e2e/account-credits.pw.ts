import { expect, test } from "@playwright/test";

test("account credits column refreshes with usage and fits wide and narrow tables", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("codex-switch:language", "zh");
    localStorage.setItem("codex-switch:account-display-mode", "table");
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "账户管理", exact: true }).click();
  const refresh = page.getByRole("button", { name: "刷新额度", exact: true });
  const balances = page.locator(".account-credits");
  await expect(balances.first()).toHaveText("62,500");
  await expect(balances.nth(1)).toHaveText("0");
  await expect(balances.nth(2)).toHaveText("—");
  for (const width of [1600, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await balances.first().scrollIntoViewIfNeeded();
    // Center the balance between pinned columns, as a user would by scrolling the table.
    await balances.first().evaluate((balance) => {
      const body = balance.closest<HTMLElement>(".ant-table-body");
      const left = body?.querySelector("td.ant-table-cell-fix-left-last")?.getBoundingClientRect();
      const right = body?.querySelector("td.ant-table-cell-fix-right-first")?.getBoundingClientRect();
      if (!body || !left || !right) return;
      const cell = balance.getBoundingClientRect();
      body.scrollLeft += (cell.left + cell.right - left.right - right.left) / 2;
    });
    await expect(refresh).toBeInViewport();
    await expect(balances.first()).toBeInViewport();
    await page.screenshot({ path: `../../.codex-tmp/account-credits-${width}.png` });
  }
  await refresh.click();
  await expect(page.getByText("所有账户用量已刷新", { exact: true })).toBeVisible();
  await expect(refresh).toBeEnabled();
  expect(errors).toEqual([]);
});
