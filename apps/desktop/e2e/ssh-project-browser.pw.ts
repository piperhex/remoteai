import { expect, test, type Page } from '@playwright/test';
import { sshEditorFixture } from './ssh-editor-fixture';

const row = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const editor = (page: Page) => page.getByRole('textbox', { name: '文件内容', exact: true });

async function connect(page: Page, mode: string) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('codex-switch.project-browser.auto-save', '0'));
  await page.goto(`/e2e/ssh-harness.html?mode=${mode}&cloud=1`);
  await page.getByRole('button', { name: mode === 'web' ? '打开远程终端' : '打开终端', exact: true }).click();
  await page.getByRole('button', { name: '终端连接选项' }).click();
  await page.getByRole('menuitem', { name: 'Editor server', exact: true }).click();
  await page.getByRole('button', { name: '远程文件浏览', exact: true }).click();
  await expect(row(page, 'hello.txt')).toBeVisible();
  const resize = page.getByRole('separator', { name: '调整详情抽屉宽度' });
  await resize.focus(); await page.keyboard.press('End');
  await expect(page.locator('.pf-browser')).toHaveAttribute('data-narrow', 'false');
}

async function checkTree(page: Page) {
  await row(page, '中文目录').click();
  await expect(row(page, 'nested.txt')).toBeVisible();
  await expect(row(page, '中文目录')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: '显示隐藏文件', exact: true })).toHaveCount(0);
  const more = page.getByRole('button', { name: '项目文件夹操作', exact: true });
  const hidden = page.getByRole('menuitemcheckbox', { name: '显示隐藏文件', exact: true });
  await more.click();
  await expect(hidden).toBeChecked();
  expect((await page.getByRole('menu').boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: test.info().outputPath('ssh-hidden-files-menu.png'), animations: 'disabled' });
  await hidden.click();
  await expect(hidden).toHaveCount(0);
  await expect(row(page, '.hidden')).toHaveCount(0);
  await more.click();
  await expect(hidden).not.toBeChecked();
  await page.keyboard.press('End');
  await expect(hidden).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row(page, '.hidden')).toBeVisible();
  await more.click();
  await expect(hidden).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(hidden).toHaveCount(0);
  const search = page.locator('.pf-tree-search input');
  await search.fill('nested');
  await expect(row(page, 'nested.txt')).toContainText('中文目录/nested.txt');
  await search.press('Escape');
  await expect(row(page, 'script.ts')).toBeVisible();
  const divider = page.getByRole('separator', { name: '调整文件树宽度' });
  const width = Number(await divider.getAttribute('aria-valuenow'));
  await divider.focus(); await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', String(width + 20));
}

async function checkDrafts(page: Page) {
  await row(page, 'script.ts').click();
  await expect(editor(page)).toContainText('const greeting');
  await expect(page.locator('.cm-line span[class]')).not.toHaveCount(0);
  await editor(page).fill('const draft = "保留草稿";\n');
  await row(page, 'hello.txt').click();
  await expect(page.getByRole('tab', { name: 'script.ts', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'script.ts', exact: true }).click();
  await expect(editor(page)).toContainText('保留草稿');
  const path = page.getByRole('textbox', { name: '远程路径' });
  await path.fill('/中文目录'); await path.press('Enter');
  await expect(row(page, 'nested.txt')).toBeVisible();
  await expect(editor(page)).toContainText('保留草稿');
  await page.getByRole('button', { name: '上一级', exact: true }).click();
  await expect(path).toHaveValue('/');
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await page.getByPlaceholder('查找', { exact: true }).fill('draft');
  await expect(page.locator('.cm-searchMatch')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
}

async function checkRenameAndDownload(page: Page) {
  await row(page, 'script.ts').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '复制', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('renamed.ts');
  await page.getByRole('alertdialog').getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'renamed.ts', exact: true })).toBeVisible();
  await expect(row(page, 'renamed.ts')).toBeVisible();
  await row(page, 'image.bin').click();
  await expect(page.getByText('此文件暂不支持预览。', { exact: true })).toBeVisible();
  await row(page, 'image.bin').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '下载', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已加入下载管理' })).toBeVisible();
  await page.getByRole('button', { name: '下载管理', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('article', { name: 'image.bin', exact: true })
    .getByRole('button', { name: '保存到设备', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('image.bin');
  await page.getByRole('button', { name: '返回 SSH', exact: true }).click();
}

async function checkWorkspaceClose(page: Page) {
  const drawer = page.locator('aside[data-details-panel]');
  const tabs = drawer.getByRole('tablist', { name: '侧栏内容', exact: true });
  await expect(tabs.getByRole('tab', { name: '文件更改', exact: true })).toHaveCount(0);
  await tabs.getByRole('button', { name: '关闭editor.test 远程文件浏览', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('tabpanel', { name: 'user@editor.test:22', exact: true }).locator('.xterm')).toBeVisible();
  await page.getByRole('button', { name: '远程文件浏览', exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(editor(page)).toContainText('保留草稿');
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: SSH shares the local tree, tabs, editor, drafts and responsive layout`, async ({ page }, info) => {
    const fixture = await sshEditorFixture(page);
    await connect(page, mode);
    await checkTree(page);
    await checkDrafts(page);
    await checkWorkspaceClose(page);
    fixture.failNextSave();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('文件操作失败');
    await expect(editor(page)).toContainText('保留草稿');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.pf-status:visible')).toContainText('已保存');
    expect(fixture.files.get('/script.ts')!.toString()).toBe('\ufeffconst draft = "保留草稿";\r\n');
    await editor(page).fill('unsaved');
    await page.getByRole('button', { name: '关闭文件 script.ts', exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    expect((await confirm.boundingBox())!.width).toBeLessThanOrEqual(400);
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor(page)).toContainText('unsaved');
    await page.screenshot({ path: info.outputPath(`ssh-browser-${mode}-light.png`), animations: 'disabled' });
    await checkRenameAndDownload(page);
    for (const [language, label] of [['English', 'Remote path'], ['Русский', 'Удалённый путь'],
      ['日本語', 'リモートパス'], ['中文', '远程路径']]) {
      await page.getByRole('button', { name: language, exact: true }).evaluate(button => button.click());
      await expect(page.getByRole('textbox', { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: '切换主题' }).evaluate(button => button.click());
    await page.screenshot({ path: info.outputPath(`ssh-browser-${mode}-dark.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 900, height: 700 });
    const resize = page.getByRole('separator', { name: '调整详情抽屉宽度' });
    await resize.focus(); await page.keyboard.press('Home');
    await expect(page.locator('.pf-browser')).toHaveAttribute('data-narrow', 'true');
    await page.getByRole('button', { name: '返回文件列表', exact: true }).click();
    await row(page, 'renamed.ts').click();
    await expect(editor(page)).toContainText('unsaved');
    await expect(page.getByRole('tree')).toBeHidden();
    await page.screenshot({ path: info.outputPath(`ssh-browser-${mode}-narrow.png`), animations: 'disabled' });
  });
}
