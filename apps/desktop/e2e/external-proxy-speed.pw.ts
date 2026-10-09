import { expect, test } from "@playwright/test";

for (const display of ["table", "cards"]) {
  test(`external proxy lightning cycles beside model context in ${display} view`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((display) => {
      localStorage.setItem("codex-switch:language", "zh");
      localStorage.setItem("codex-switch:account-display-mode", display);
      localStorage.setItem("codex-switch:local-proxy-port", "8080");
      localStorage.setItem("codex-switch:local-proxy-running", "true");
      localStorage.setItem("codex-switch:token-usage-refresh-seconds", "1");
    }, display);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "账户管理", exact: true }).click();
    const summary = page.locator(".account-table-toolbar-summary:visible");
    const speed = summary.locator(".request-speed-button");
    const context = summary.locator(".model-context-window-control");
    await expect(speed).toHaveAttribute("data-speed", "normal");
    for (const [mode, count, tier] of [["fast", 1, "priority"], ["ultrafast", 2, "ultrafast"],
      ["normal", 0, "default"]] as const) {
      await speed.click();
      await expect(speed).toHaveAttribute("data-speed", mode);
      await expect(speed.locator(".is-lit")).toHaveCount(count);
      expect(await page.evaluate(() => localStorage.getItem("codex-switch:local-proxy-service-tier"))).toBe(tier);
    }
    for (const width of [1440, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(speed).toBeInViewport();
      const contextBox = await context.boundingBox();
      const speedBox = await speed.boundingBox();
      expect(speedBox!.x).toBeGreaterThanOrEqual(contextBox!.x + contextBox!.width);
      expect(Math.abs(speedBox!.y + speedBox!.height / 2 - contextBox!.y - contextBox!.height / 2)).toBeLessThan(2);
      await page.screenshot({
        path: `../../.codex-tmp/external-speed-${display}-${width}.png`, animations: "disabled",
      });
    }
    const toolbox = page.getByRole("button", { name: "工具箱", exact: true });
    await expect(toolbox).toHaveCSS("border-radius", "9px");
    await toolbox.click();
    const menu = page.getByRole("group", { name: "工具箱", exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: /普通|Fast|快速/ })).toHaveCount(0);
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(400);
    await page.screenshot({ path: `../../.codex-tmp/external-speed-toolbox-${display}.png`, animations: "disabled" });
    expect(errors).toEqual([]);
  });
}

test("external proxy speed stays disabled while the proxy is stopped", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("codex-switch:language", "zh");
    localStorage.setItem("codex-switch:local-proxy-port", "8080");
    localStorage.setItem("codex-switch:local-proxy-running", "false");
    localStorage.setItem("codex-switch:local-proxy-service-tier", "ultrafast");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "账户管理", exact: true }).click();
  const speed = page.locator(".account-table-toolbar-summary:visible .request-speed-button");
  await expect(speed).toBeDisabled();
  await expect(speed).toHaveAttribute("data-speed", "normal");
});
