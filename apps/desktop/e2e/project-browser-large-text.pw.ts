import { expect, test, type Page } from '@playwright/test';
import { sshEditorFixture } from './ssh-editor-fixture';

async function replaceText(page: Page) {
  await expect(page.locator('.pf-editor:visible')).toHaveAttribute('data-plain-text', 'true');
  await expect(page.locator('.pf-editor:visible .cm-foldGutter')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '全部折叠', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '查找', exact: true }).click();
  const panel = page.locator('.pf-search-panel');
  const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
  await panel.getByRole('button', { name: '正则表达式', exact: true }).click();
  await panel.getByRole('textbox', { name: '查找', exact: true }).fill('const|needle');
  await panel.getByRole('button', { name: '全选', exact: true }).click();
  await editor.press('x');
  await expect(editor).toContainText('x x =');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).toContainText('const needle =');
  await panel.getByRole('button', { name: '正则表达式', exact: true }).click();
  await panel.getByRole('textbox', { name: '查找', exact: true }).fill('needle');
  await panel.locator('.pf-search-disclosure').click();
  await panel.getByRole('textbox', { name: '替换', exact: true }).fill('replacement');
  await panel.getByRole('button', { name: '全部替换', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText('needle');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文件内容', exact: true })).toContainText('replacement');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.pf-status:visible')).toContainText('已保存');
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: large local and SSH files keep search, replace, undo and save in plain text mode`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('codex-switch.project-browser.auto-save', '0'));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/e2e/project-browser-harness.html?mode=${mode}&largeText=1`);
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await page.getByRole('treeitem', { name: 'large.ts', exact: true }).click();
    await replaceText(page);
    const saved = await page.evaluate(() => {
      const text = (window as unknown as { savedFiles: { text: string }[] }).savedFiles.at(-1)!.text;
      return { size: new TextEncoder().encode(text).length, replaced: text.startsWith('const replacement') };
    });
    expect(saved.size).toBeGreaterThan(5 * 1024 * 1024);
    expect(saved.replaced).toBe(true);
    await page.screenshot({ path: info.outputPath(`large-local-${mode}.png`) });
    const fixture = await sshEditorFixture(page);
    fixture.files.set('/large.ts', Buffer.from('const needle = "start";\r\n' + '// plain text padding\r\n'.repeat(250_000)));
    await page.goto(`/e2e/ssh-harness.html?mode=${mode}&cloud=1`);
    await page.getByRole('button', { name: mode === 'web' ? '打开远程终端' : '打开终端', exact: true }).click();
    await page.getByRole('button', { name: '终端连接选项' }).click();
    await page.getByRole('menuitem', { name: 'Editor server', exact: true }).click();
    await page.getByRole('button', { name: '远程文件浏览', exact: true }).click();
    await page.getByRole('treeitem', { name: 'large.ts', exact: true }).click();
    await replaceText(page);
    expect(fixture.files.get('/large.ts')!.toString().startsWith('const replacement')).toBe(true);
    expect(fixture.files.get('/large.ts')!.toString()).toContain('\r\n');
    await page.screenshot({ path: info.outputPath(`large-ssh-${mode}.png`) });
  });
}

test('a 5 MiB project file opens one editable plain-text window and preserves undo history', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/e2e/project-browser-harness.html?mode=standalone&largeText=1&atThreshold=1');
  await page.getByRole('treeitem', { name: 'large.ts', exact: true }).click();
  const pane = page.locator('.pf-editor:visible');
  await expect(pane).toHaveAttribute('data-plain-text', 'true');
  await expect(page.locator('.pf-window-navigation')).toBeVisible();
  const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
  await editor.press('Control+End');
  await page.keyboard.insertText('中');
  await expect(pane).toHaveAttribute('data-plain-text', 'true');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).not.toContainText('中');
  await expect(pane).toHaveAttribute('data-plain-text', 'true');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(pane).toHaveAttribute('data-plain-text', 'true');
  await expect(editor).toContainText('中');
});
