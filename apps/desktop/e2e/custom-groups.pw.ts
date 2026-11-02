import { expect, test } from '@playwright/test';
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: nested groups, menus, management and saved membership`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/e2e/custom-groups-harness.html?mode=${mode}`);
    const project = page.getByRole('button', { name: mode === 'web' ? '折叠项目：remote-ai' : 'remote-ai', exact: true });
    await project.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '移动到分组' }).hover();
    await expect(page.getByRole('menuitem', { name: '工作 / 客户端', exact: true })).toBeVisible();
    const menu = page.locator('.chat-custom-group-menu');
    await expect(menu.getByRole('menuitem').last()).toHaveText('管理分组');
    await page.screenshot({ path: `../../.codex-tmp/custom-groups/${mode}-submenu.png` });
    await page.getByRole('menuitem', { name: '工作 / 客户端', exact: true }).click();
    await expect(page.getByRole('button', { name: '分组设计讨论', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '折叠分组：工作' }).click();
    await expect(project).toBeHidden();
    await page.getByRole('button', { name: '展开分组：工作' }).click();
    await page.getByRole('button', { name: '分组设计讨论', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '移动到分组' }).hover();
    await page.getByRole('menuitem', { name: '研究', exact: true }).click();
    await page.screenshot({ path: `../../.codex-tmp/custom-groups/${mode}-tree.png` });
    await page.reload();
    await expect(page.getByRole('button', { name: '分组设计讨论', exact: true })).toBeVisible();
    // The local sidebar only exposes the native Explorer action inside Tauri.
    if (mode !== 'local') {
      await page.getByRole('button', { name: '分组设计讨论', exact: true }).click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: '在资源管理器中打开', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: '管理分组', exact: true }).first().click();
    await page.getByRole('button', { name: '新增分组', exact: true }).click();
    await page.getByRole('textbox', { name: '分组名称' }).fill('待办');
    await page.getByRole('button', { name: /保\s*存/ }).click();
    const row = page.getByRole('row').filter({ hasText: '待办' });
    await row.getByRole('button', { name: '编辑分组' }).click();
    await page.getByRole('textbox', { name: '分组名称' }).fill('下周计划');
    await page.getByRole('combobox', { name: '上级分组' }).focus();
    await page.keyboard.press('ArrowDown');
    await page.getByText('工作 / 客户端', { exact: true }).last().click();
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 160;
      const context = canvas.getContext('2d')!; context.fillStyle = '#237b76'; context.fillRect(0, 0, 256, 160);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.getByLabel('上传图标').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
    await page.getByRole('button', { name: /保\s*存/ }).click();
    await expect(page.getByRole('row').filter({ hasText: '下周计划' }).locator('img')).toBeVisible();
    await page.getByRole('tab', { name: '项目与对话' }).click();
    await expect(page.getByRole('row').filter({ hasText: '分组设计讨论' })).toContainText('研究');
    await page.getByRole('row').filter({ hasText: '发布检查清单' }).getByRole('checkbox').check();
    await page.locator('.chat-group-destination .ant-select-selector').click();
    await page.getByText('工作 / 客户端 / 下周计划', { exact: true }).last().click();
    await page.getByRole('button', { name: '应用分组' }).click();
    await expect(page.getByRole('row').filter({ hasText: '发布检查清单' })).toContainText('下周计划');
    await page.screenshot({ path: `../../.codex-tmp/custom-groups/${mode}-manager.png` });
    await page.getByRole('tab', { name: '分组', exact: true }).click();
    await page.getByRole('row').filter({ hasText: '下周计划' }).getByRole('button', { name: '删除分组' }).click();
    await page.getByRole('dialog', { name: '删除“下周计划”？' }).getByRole('button', { name: '删除分组' }).click();
    await expect(page.getByRole('row').filter({ hasText: '下周计划' })).toHaveCount(0);
  });
}

test('touch: project and conversation long press share group picker and management', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/e2e/custom-groups-harness.html?mode=web');
  const hold = async (name: string) => {
    const target = page.getByRole('button', { name, exact: true });
    await target.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1,
      isPrimary: true, button: 0, clientX: 60, clientY: 160 });
    await page.waitForTimeout(650);
    await target.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1 });
  };
  await hold('折叠项目：remote-ai');
  await page.getByRole('button', { name: '移动到分组', exact: true }).click();
  await expect(page.getByRole('button', { name: '工作 / 客户端', exact: true })).toBeVisible();
  await page.screenshot({ path: '../../.codex-tmp/custom-groups/web-mobile-picker.png' });
  await page.getByRole('button', { name: '工作 / 客户端', exact: true }).click();
  await hold('分组设计讨论');
  await page.getByRole('button', { name: '移动到分组', exact: true }).click();
  await page.getByRole('button', { name: '管理分组', exact: true }).last().click();
  await expect(page.getByRole('dialog').getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑分组', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '客户端 的更多操作', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '删除分组' })).toBeVisible();
  await page.getByRole('menuitem', { name: '删除分组' }).click({ trial: true });
  await page.screenshot({ path: '../../.codex-tmp/custom-groups/web-mobile-group-menu.png', animations: 'disabled' });
  await page.getByRole('menuitem', { name: '编辑分组' }).click();
  await expect(page.getByRole('textbox', { name: '分组名称' })).toHaveValue('客户端');
  await page.getByRole('dialog', { name: '编辑分组', exact: true }).getByRole('button', { name: /取\s*消/ }).click();
  await page.getByRole('button', { name: '客户端 的更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除分组' }).click();
  await page.getByRole('dialog', { name: '删除“客户端”？', exact: true })
    .getByRole('button', { name: /取\s*消/ }).click();
  await page.screenshot({ path: '../../.codex-tmp/custom-groups/web-mobile-groups.png' });
  await page.getByRole('tab', { name: '项目与对话' }).click();
  await page.getByRole('checkbox', { name: '选择 发布检查清单', exact: true }).check();
  await page.locator('.chat-group-destination .ant-select-selector').click();
  await page.getByText('研究', { exact: true }).last().click();
  await page.getByRole('button', { name: '应用分组', exact: true }).click();
  const member = page.locator('.chat-group-card').filter({ hasText: '发布检查清单' });
  await expect(member).toContainText('研究');
  await expect(page.getByRole('dialog').getByRole('table')).toHaveCount(0);
  await page.getByLabel('搜索项目或对话', { exact: true }).fill('发布检查清单');
  await page.screenshot({ path: '../../.codex-tmp/custom-groups/web-mobile-manager.png' });
  await context.close();
});

test('dark mode, language changes and desktop touch menu stay usable', async ({ page }) => {
  await page.goto('/e2e/custom-groups-harness.html?mode=local&dark');
  const target = page.getByRole('button', { name: '分组设计讨论', exact: true });
  await target.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0,
    clientX: 100, clientY: 350 });
  await expect(page.getByRole('menuitem', { name: '移动到分组' })).toBeVisible();
  await target.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
  await page.getByRole('menuitem', { name: '移动到分组' }).hover();
  await page.getByRole('menuitem', { name: '管理分组' }).click();
  await page.screenshot({ path: '../../.codex-tmp/custom-groups/local-dark-manager.png' });
  for (const [language, label, create] of [['en', 'Manage groups', 'New group'],
    ['ja', 'グループを管理', '新規グループ'], ['ru', 'Управление группами', 'Новая группа']]) {
    await page.goto(`/e2e/custom-groups-harness.html?mode=web&lang=${language}`);
    await page.getByRole('button', { name: label, exact: true }).first().click();
    await expect(page.getByRole('button', { name: create, exact: true })).toBeVisible();
  }
});
