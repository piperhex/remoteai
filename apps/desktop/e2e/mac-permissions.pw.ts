import { expect, test } from '@playwright/test';

test('confirms a scoped repair, keeps the other grant and requires explicit restart', async ({ page }, info) => {
  await page.goto('/e2e/mac-permissions-harness.html');
  const repair = page.getByRole('button', { name: '修复屏幕录制权限', exact: true });
  await repair.click();
  const confirmation = page.locator('.ant-popconfirm');
  await expect(confirmation).toContainText('将清除 Remote AI 的屏幕录制授权');
  expect((await confirmation.boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.getByRole('button', { name: /取\s*消/ }).click();
  await expect(page.locator('body')).toHaveAttribute('data-repairs', '0');
  await repair.click();
  await page.getByRole('button', { name: '重置并去授权', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-permission', 'screenRecording');
  await expect(page.locator('body')).toHaveAttribute('data-repairs', '1');
  await expect(page.getByText('已开启', { exact: true })).toHaveCount(1);
  await expect(page.getByText('权限已重置，请重新授权', { exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-restarts', '0');
  await page.screenshot({ path: info.outputPath('mac-permission-repair.png') });
  await page.getByRole('button', { name: '完成授权后重启', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-restarts', '1');
});

test('retains reauthorization and restart instructions when Settings fails to open', async ({ page }) => {
  await page.goto('/e2e/mac-permissions-harness.html?settings-fail');
  await page.getByRole('button', { name: '修复辅助功能权限', exact: true }).click();
  await page.getByRole('button', { name: '重置并去授权', exact: true }).click();
  await expect(page.getByText('权限已重置，请手动打开系统设置', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '完成授权后重启', exact: true })).toBeEnabled();
  await expect(page.locator('body')).toHaveAttribute('data-permission', 'accessibility');
});
