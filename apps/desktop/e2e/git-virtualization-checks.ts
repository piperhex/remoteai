import { expect, test, type Locator, type Page } from '@playwright/test';

const LARGE_GIT_FILE_COUNT = 12_000;

const fileLabel = (index: number) => `选择 src/generated/file-${String(index).padStart(5, '0')}.ts`;

async function expectVisibleRowsOnly(list: Locator, rowSelector = '.git-file') {
  await expect.poll(() => list.evaluate((element, selector) => {
    const viewport = element.getBoundingClientRect();
    const rows = Array.from(element.querySelectorAll(selector));
    return rows.length > 0 && rows.length < 30 && rows.every(row => {
      const bounds = row.getBoundingClientRect();
      return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
    });
  }, rowSelector)).toBe(true);
}

async function openGit(page: Page, mode: string) {
  if (mode === 'web') {
    await page.getByRole('button', { name: '打开工具', exact: true }).click();
    await page.getByRole('button', { name: 'Git', exact: true }).click();
  } else await page.getByRole('button', { name: '打开 Git', exact: true }).click();
}

export function gitVirtualizationChecks(mode: string, url: string) {
  for (const enlarged of [false, true]) {
    test(`${mode}: only visible changes mount among 12000 files (${enlarged ? 'large narrow' : 'default'})`,
      async ({ page }, info) => {
        await page.setViewportSize({ width: enlarged ? 940 : 1440, height: 960 });
        await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
        await page.goto(`${url}?mode=${mode}&largeGit`
          + (enlarged ? '&font=20&dark' : ''));
        await openGit(page, mode);
        const list = page.getByRole('tree', { name: 'Git 仓库', exact: true });
        await expect(page.getByRole('tab', { name: `改动 ${LARGE_GIT_FILE_COUNT}`, exact: true })).toBeVisible();
        await expectVisibleRowsOnly(list);
        await expect(page.getByRole('checkbox', { name: fileLabel(0), exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox', { name: fileLabel(1000), exact: true })).toHaveCount(0);
        await page.getByRole('checkbox', { name: '全选', exact: true }).check();
        await expect(page.getByRole('button', { name: `提交 ${LARGE_GIT_FILE_COUNT} 个文件`, exact: true }))
          .toBeDisabled();
        await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
        const last = page.getByRole('checkbox', { name: fileLabel(LARGE_GIT_FILE_COUNT - 1), exact: true });
        await expect(last).toBeVisible();
        await expect(last).toBeChecked();
        await expect(page.getByRole('checkbox', { name: fileLabel(0), exact: true })).toHaveCount(0);
        await expectVisibleRowsOnly(list);
        await page.getByRole('button', { name: '刷新 Git', exact: true }).click();
        await expect(last).toBeVisible();
        await expect(last).toBeChecked();
        await page.screenshot({ path: info.outputPath(`${mode}-changes-bottom.png`), animations: 'disabled' });
        await list.evaluate(element => { element.scrollTop = 0; });
        const folder = page.getByRole('button', { name: '展开或收起 src/generated', exact: true });
        await folder.click();
        await expect(list.locator('.git-file-file')).toHaveCount(0);
        await expect(list.locator('.git-file')).toHaveCount(3);
        await expect(list).toContainText(String(LARGE_GIT_FILE_COUNT));
        await page.screenshot({ path: info.outputPath(`${mode}-changes-collapsed.png`), animations: 'disabled' });
        await folder.click();
        await expectVisibleRowsOnly(list);
        await page.getByRole('button', { name: '平铺', exact: true }).click();
        await expect(list.locator('.git-file-folder')).toHaveCount(0);
        await expectVisibleRowsOnly(list);
        await page.screenshot({ path: info.outputPath(`${mode}-changes-flat.png`), animations: 'disabled' });
        await page.getByRole('tab', { name: '提交记录', exact: true }).click();
        await page.locator('.git-history-row').first().click();
        const committed = page.locator('.git-commit-files');
        await expectVisibleRowsOnly(committed, '.git-commit-file');
        await committed.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await expect(committed.getByRole('button', {
          name: `查看 src/generated/file-${LARGE_GIT_FILE_COUNT - 1}.ts`, exact: true,
        })).toBeVisible();
        await expectVisibleRowsOnly(committed, '.git-commit-file');
        await page.screenshot({ path: info.outputPath(`${mode}-commit-files-bottom.png`), animations: 'disabled' });
        await page.getByRole('button', { name: '返回提交记录', exact: true }).click();
        await page.getByRole('tab', { name: /^改动/ }).click();
        if (enlarged) await page.getByRole('separator', { name: '调整详情抽屉宽度' }).press('Home');
        await page.getByRole('button', { name: '文件浏览', exact: true }).click();
        await expect(page.locator('.git-file')).toHaveCount(0);
        await page.getByRole('tab', { name: 'Git', exact: true }).click();
        await expectVisibleRowsOnly(list);
        await page.getByRole('textbox', { name: '提交说明', exact: true }).fill('test: commit all visible and hidden files');
        await page.getByRole('button', { name: `提交 ${LARGE_GIT_FILE_COUNT} 个文件`, exact: true }).click();
        await expect(page.locator('body')).toHaveAttribute('data-git-submitted-count', String(LARGE_GIT_FILE_COUNT));
        await expect(list).toContainText('工作区没有未提交的改动。');
      });
  }
}
