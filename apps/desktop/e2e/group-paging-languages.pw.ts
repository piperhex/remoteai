import { expect, test } from '@playwright/test';

test.setTimeout(120_000);
const cases = [
  { lang: 'en', manage: 'Manage groups', members: 'Projects and conversations', size: 'Page size', option: '20 / page' },
  { lang: 'ja', manage: 'グループを管理', members: 'プロジェクトと会話', size: '表示件数', option: '20件 / ページ' },
  { lang: 'ru', manage: 'Управление группами', members: 'Проекты и чаты', size: 'Размер страницы', option: '20 / стр.' },
];

for (const entry of cases) {
  test(`${entry.lang}: translated pagination fits a compact desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/e2e/custom-groups-harness.html?paging&lang=${entry.lang}`);
    await page.getByRole('button', { name: entry.manage, exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: entry.manage, exact: true });
    await dialog.getByRole('tab', { name: entry.members, exact: true }).click();
    await expect(dialog.locator('.chat-group-members-table .ant-table-row')).toHaveCount(20);
    await expect(dialog.getByRole('combobox', { name: entry.size })).toBeInViewport();
    await expect(dialog.locator('.chat-group-members-footer')).toContainText(entry.option);
    expect(await dialog.locator('.ant-modal-content').evaluate(element => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: `../../.codex-tmp/group-paging/local-${entry.lang}-compact.png`,
      animations: 'disabled' });
  });
}
