import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/cli-ui-parity-evidence');
async function longPress(row: Locator) {
  const box = await row.boundingBox();
  await row.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: true,
    button: 0, clientX: box!.x + 20, clientY: box!.y + box!.height / 2 });
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: composer menus, isolated drafts and conversation gestures`, async ({ page }) => {
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 960, height: 900 });
    if (mode === 'local') await nativeShell(page);
    await localBackend(page);
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native&dark&large`);
    const selector = page.locator('.cli-gui-engine:visible');
    await selector.click(); await page.getByRole('menuitem', { name: 'Claude GUI', exact: true }).click();
    const pane = page.locator('.cli-gui-pane');
    const input = pane.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('检查项目文件');
    await pane.getByRole('button', { name: mode === 'local' ? '添加' : '添加内容', exact: true }).click();
    await page.getByRole('menuitem', { name: '文件和文件夹', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('F:/projects/remote ai/README.md');
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: resolve(evidence, `${mode}-dark-large-add-path.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: /^添\s*加$/ }).click();
    await expect(input).toHaveValue('检查项目文件\n"F:/projects/remote ai/README.md"');
    await selector.click(); await page.getByRole('menuitem', { name: 'Gemini GUI', exact: true }).click();
    await expect(input).toHaveValue('');
    await input.fill('独立的 Gemini 草稿');
    await selector.click(); await page.getByRole('menuitem', { name: 'Claude GUI', exact: true }).click();
    await expect(input).toHaveValue('检查项目文件\n"F:/projects/remote ai/README.md"');
    const access = pane.getByRole('button', { name: /^访问权限：/ });
    await access.click();
    const permission = page.getByRole('menuitemradio', { name: '默认', exact: true });
    await expect(permission).toHaveAttribute('aria-checked', 'true');
    await permission.focus(); await permission.press('Escape');
    await expect(access).toBeFocused();
    await expect(permission).not.toBeVisible();
    await pane.locator('button').filter({ hasText: 'GPT-6' }).click();
    await page.getByRole('button', { name: '选择模型', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: /GPT-6/ })).toBeVisible();
    await expect(page.locator('.ant-popover:visible')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: resolve(evidence, `${mode}-dark-large-model-menu.png`), animations: 'disabled' });
    await input.click();
    const collapse = page.getByRole('button', { name: mode === 'local' ? '收起对话列表' : '收起聊天列表', exact: true });
    if (await collapse.isVisible()) await collapse.click();
    await expect(input).toBeVisible();
    await input.fill(Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 行项目检查说明`).join('\n'));
    await expect.poll(() => input.evaluate(node => node.clientHeight)).toBeGreaterThan(100);
    await page.screenshot({ path: resolve(evidence, `${mode}-dark-large-collapsed-multiline.png`), animations: 'disabled' });
    const expand = page.getByRole('button', { name: mode === 'local' ? '展开对话列表' : '打开聊天列表', exact: true });
    await expect(expand).toBeVisible(); await expand.click();
    const row = page.locator('[data-cli-thread="claude-history"]');
    await row.click({ button: 'right' });
    const archive = page.getByRole('menuitem', { name: '归档对话', exact: true });
    await expect(archive).toBeEnabled();
    const mouseActions = await page.getByRole('menuitem').allTextContents();
    await page.keyboard.press('Escape');
    await expect(archive).not.toBeVisible();
    await longPress(row);
    await expect(archive).toBeVisible();
    expect(await page.getByRole('menuitem').allTextContents()).toEqual(mouseActions);
    await row.dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0 });
    await page.screenshot({ path: resolve(evidence, `${mode}-dark-large-history-menu.png`), animations: 'disabled' });
    await archive.click();
    await expect(row).toHaveCount(0);
    await expect(page.locator('[data-cli-thread="gemini-history"]')).toBeVisible();
  });
}
