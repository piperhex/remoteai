import { expect, test } from "@playwright/test";

test("version popover opens the offline guide and imports both selected files", async ({ page }) => {
  await page.goto("/e2e/cli-import-harness.html");
  await page.getByRole("button", { name: "Codex v0.160.0" }).click();
  const check = await page.getByRole("button", { name: "检查版本", exact: true }).boundingBox();
  const manual = page.getByRole("button", { name: "手动下载", exact: true });
  const position = await manual.boundingBox();
  expect(position!.x).toBeGreaterThan(check!.x);
  expect(position!.y).toBe(check!.y);
  await manual.click();
  const dialog = page.getByRole("dialog", { name: "手动下载 Codex" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "下载文件" })).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: "导入并安装" })).toBeDisabled();
  await dialog.getByRole("button", { name: "选择文件", exact: true }).first().click();
  await dialog.getByRole("button", { name: "选择文件", exact: true }).click();
  await expect(dialog.getByText("已选择：rust-v0.161.0")).toBeVisible();
  await page.screenshot({ path: "../../.codex-tmp/cli-import-selected.png" });
  await dialog.getByRole("button", { name: "导入并安装" }).click();
  await expect(dialog.getByRole("button", { name: /^关\s*闭$/ })).toBeDisabled();
  await expect(dialog.getByText("Codex 已安装，可以开始使用了。")).toBeVisible();
  await dialog.getByRole("button", { name: /^关\s*闭$/ }).click();
  await expect(page.getByRole("button", { name: "Codex v0.161.0" })).toBeVisible();
});

test("first-install guide fits a narrow window and keeps errors inside the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto("/e2e/cli-import-harness.html?first&failure");
  await page.getByRole("button", { name: "手动下载", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "手动下载 Codex" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "选择文件", exact: true }).first().click();
  await dialog.getByRole("button", { name: "选择文件", exact: true }).click();
  await dialog.getByRole("button", { name: "导入并安装" }).click();
  await expect(dialog.getByText("安装包与校验文件不匹配，请下载同一版本、适合当前电脑的文件。")).toBeVisible();
  const dimensions = await dialog.evaluate(element => ({
    width: element.getBoundingClientRect().width, overflow: element.scrollWidth > element.clientWidth,
  }));
  expect(dimensions.width).toBeLessThanOrEqual(390);
  expect(dimensions.overflow).toBe(false);
  await expect(dialog.getByRole("button", { name: "重新选择" })).toHaveCount(2);
  await page.screenshot({ path: "../../.codex-tmp/cli-import-narrow.png" });
});
