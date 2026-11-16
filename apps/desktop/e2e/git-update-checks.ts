import { expect, type Page, type TestInfo } from '@playwright/test';

export async function checkSafeUpdate({ page, info, url, label }: {
  page: Page; info: TestInfo; url: string; label: string;
}) {
  await page.goto(url);
  await page.getByRole('button', { name: '更新项目', exact: true }).click();
  const menu = page.getByRole('region', { name: '同步项目', exact: true });
  await expect(menu).toContainText('包括未跟踪文件');
  await menu.getByRole('combobox', { name: '整合方式' }).selectOption('rebase');
  const bodyFont = await menu.evaluate(element => getComputedStyle(element).fontSize);
  await expect(menu.getByRole('combobox')).toHaveCSS('font-size', bodyFont);
  await expect(menu.getByRole('button', { name: '执行 更新项目' })).toBeEnabled();
  expect(await menu.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath(`${label}-dirty.png`), animations: 'disabled' });
  await menu.getByRole('button', { name: '执行 更新项目' }).click();
  await expect(page.getByRole('status')).toContainText('正在更新项目');
  await expect(page.getByRole('button', { name: '更新项目', exact: true })).toBeDisabled();
  await expect(page.getByTestId('strategy')).toHaveText('rebase');
  await page.screenshot({ path: info.outputPath(`${label}-progress.png`), animations: 'disabled' });
  await page.getByRole('button', { name: 'Finish request' }).click();
  await expect(page.getByRole('status')).toContainText('更新完成，本地修改已保留');
  await page.screenshot({ path: info.outputPath(`${label}-success.png`), animations: 'disabled' });

  await page.goto(`${url}&conflict`);
  await page.getByRole('button', { name: '拉取 Pull', exact: true }).click();
  await page.getByRole('button', { name: '执行 拉取 Pull' }).click();
  await page.getByRole('button', { name: 'Finish request' }).click();
  await expect(page.getByRole('alert')).toContainText('备份已保留');
  await page.getByText('查看恢复方法', { exact: true }).click();
  await expect(page.locator('.git-update-recovery code').first()).toContainText('git stash show --include-untracked');
  await expect(page.getByRole('button', { name: '已检查恢复结果，保留备份' })).toBeDisabled();
  await page.screenshot({ path: info.outputPath(`${label}-restore-conflict.png`), animations: 'disabled' });
  await page.getByRole('button', { name: '解决冲突', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: '解决合并冲突', exact: true });
  await expect(editor.locator('.gm-pane')).toHaveCount(3);
  await expect(editor.getByText('保存的本地修改', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`${label}-editor.png`), animations: 'disabled' });

  await page.goto(`${url}&collision`);
  await page.getByRole('button', { name: '更新项目', exact: true }).click();
  await page.getByRole('button', { name: '执行 更新项目' }).click();
  await page.getByRole('button', { name: 'Finish request' }).click();
  await expect(page.getByRole('button', { name: '已检查恢复结果，保留备份' })).toBeEnabled();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByText('View recovery options', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByText('復元方法を表示', { exact: true })).toBeVisible();
}
