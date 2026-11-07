import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`proxy details remain with their reply and responsive at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/e2e/request-error-harness.html");
    const first = page.locator('[data-turn-id="first"]');
    const notice = first.locator('details').filter({ has: page.locator('summary [role="status"]') });
    await expect(notice.locator('summary')).toContainText("连接暂时中断，Codex 正在重试…");
    await expect(notice).not.toContainText("Reconnecting");
    await expect(notice).not.toContainText("localhost:8080");
    await expect(notice.locator("pre")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('desktop-local-retrying.png') });
    await notice.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(notice).toContainText("Codex 正在重试");
    await expect(notice.locator("pre")).toContainText("upstream timed out");
    await expect(notice.locator("pre")).toContainText("Reconnecting... 4/5 unexpected status 502");
    const details = notice.locator('pre').locator('..');
    expect((await details.boundingBox())!.width).toBeLessThanOrEqual(400);
    await expect.poll(() => notice.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('desktop-local-details.png') });
    const refreshes = Number(await page.getByLabel("刷新次数").textContent());
    await page.getByLabel("消息", { exact: true }).fill("继续检查");
    await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(refreshes);
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue("继续检查");
    const before = first.locator('[data-message-id="before"]');
    expect((await before.boundingBox())!.y).toBeLessThan((await notice.boundingBox())!.y);
    await page.getByRole("button", { name: "恢复连接" }).click();
    await expect(notice).toContainText("现已恢复");
    await expect(notice.locator("pre")).toBeVisible();
    const after = first.locator('[data-message-id="after"]');
    expect((await notice.boundingBox())!.y).toBeLessThan((await after.boundingBox())!.y);
    await page.getByRole("button", { name: "继续对话" }).click();
    await expect(notice).toContainText("现已恢复");
    await expect(notice.locator("pre")).toBeVisible();
    await expect(page.locator('[data-turn-id="second"] details')).toHaveCount(0);
    const final = first.locator('[data-message-id="final"]');
    expect((await notice.boundingBox())!.y).toBeLessThan((await final.boundingBox())!.y);
    await notice.locator("summary").click();
    await expect(notice.locator("pre")).toHaveCount(0);
    await expect(notice.locator('summary')).toContainText("现已恢复");
    await expect(notice).not.toContainText("Reconnecting");
    await page.screenshot({ path: info.outputPath('desktop-local-recovered.png') });
  });
}
