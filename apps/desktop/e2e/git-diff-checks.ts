import { expect, type Page } from '@playwright/test';

export async function checkGitDiffReview(page: Page, screenshotName: string) {
  const git = page.getByRole('dialog', { name: 'Git', exact: true });
  const selected = git.getByRole('checkbox', { name: '选择 src/app.ts', exact: true });
  await selected.check();
  await git.getByRole('textbox', { name: '提交说明' }).fill('保留这条提交说明');
  await git.getByRole('button', { name: '查看 src/app.ts', exact: true }).click();
  const diff = git.getByRole('complementary', { name: '文件更改详情', exact: true });
  await expect(diff).toBeVisible();
  await expect(diff.getByLabel('src/app.ts 的代码差异', { exact: true })).toContainText('new code');
  await expect(diff.locator('.hljs-keyword')).toContainText('new');
  await expect(diff.getByLabel('新增 1 行，删除 1 行', { exact: true })).toHaveCount(2);
  await diff.getByRole('button', { name: '展开详情抽屉', exact: true }).click();
  await page.screenshot({ path: `../../.codex-tmp/${screenshotName}-unified.png` });
  await diff.getByRole('button', { name: '并排', exact: true }).click();
  await expect(diff.getByText('修改前', { exact: true })).toBeVisible();
  await expect(diff.getByText('修改后', { exact: true })).toBeVisible();
  await page.screenshot({ path: `../../.codex-tmp/${screenshotName}-split.png` });
  await diff.getByRole('button', { name: '最小化详情抽屉', exact: true }).click();
  await expect(diff).toBeHidden();
  await expect(selected).toBeChecked();
  await expect(git.getByRole('textbox', { name: '提交说明' })).toHaveValue('保留这条提交说明');
  await git.getByRole('button', { name: '恢复文件更改', exact: true }).click();
  await expect(diff.getByRole('button', { name: '并排', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await diff.getByRole('button', { name: '还原抽屉宽度', exact: true }).click();
  await diff.getByRole('button', { name: '关闭详情抽屉', exact: true }).click();
  await git.getByRole('button', { name: '查看 src/app.ts', exact: true }).click();
  await expect(diff).toBeVisible();
  await diff.getByRole('button', { name: '关闭详情抽屉', exact: true }).press('Escape');
  await expect(diff).toHaveCount(0);
  await expect(git).toBeVisible();
  await expect(selected).toBeChecked();
  await checkCommitDiff(page);
}

async function checkCommitDiff(page: Page) {
  const git = page.getByRole('dialog', { name: 'Git', exact: true });
  await git.getByRole('tab', { name: '提交记录', exact: true }).click();
  await git.locator('.git-history-row').first().click();
  await expect(git.locator('.git-commit-file')).toHaveCount(4);
  await git.getByRole('button', { name: '查看 src/chat/tools.ts', exact: true }).click();
  const diff = git.getByRole('complementary', { name: '文件更改详情', exact: true });
  await expect(diff).toContainText('committed change');
  await expect(diff).toContainText('e950cd31');
  await diff.getByRole('button', { name: '关闭详情抽屉', exact: true }).click();
  await expect(git.locator('.git-commit-file')).toHaveCount(4);
  await git.getByRole('button', { name: '返回提交记录', exact: true }).click();
  await expect(git.locator('.git-history-row')).toHaveCount(3);
}
