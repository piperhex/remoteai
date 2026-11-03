import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

const output = '../../.codex-tmp/group-dismissal';
const cases = [
  { mode: 'local', width: 1280, name: 'desktop-local', failure: 'network' },
  { mode: 'remote', width: 1280, name: 'desktop-remote', failure: 'legacy' },
  { mode: 'web', width: 1280, name: 'web-desktop', failure: 'legacy' },
  { mode: 'web', width: 390, name: 'web-mobile', failure: 'legacy' },
];

for (const entry of cases) {
  test(`${entry.name}: dismisses failed and pending group loads without a second dialog`, async ({ page }) => {
    await page.setViewportSize({ width: entry.width, height: 844 });
    const url = `/e2e/custom-groups-harness.html?mode=${entry.mode}&failure=${entry.failure}`;
    const open = async () => {
      await page.getByRole('button', { name: '管理分组', exact: true }).first().click();
      if (entry.width > 600) await page.getByRole('tab', { name: '项目与对话' }).click();
    };
    const dialog = page.getByRole('dialog', { name: '管理分组', exact: true });
    const close = () => dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.goto(url);
    await open();
    await expect(dialog.getByRole('alert')).toContainText(entry.failure === 'legacy'
      ? '请更新电脑端 Remote AI 后重试。' : '未能加载完整列表，请重试。');
    await page.screenshot({ path: `${output}/${entry.name}-error.png` });
    await close();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: `${output}/${entry.name}-closed.png` });
    // A failure arriving after dismissal must not reopen any overlay.
    await page.goto(`${url}&delay=1200`);
    await open();
    await expect(dialog).toBeVisible();
    await close();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: `${output}/${entry.name}-late-error-closed.png` });
    await open();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
