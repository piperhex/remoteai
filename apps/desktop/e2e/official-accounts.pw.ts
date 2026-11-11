import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function capture(page: Page, info: TestInfo, state: string) {
  if (state.endsWith('source-menu')) await expect(page.getByRole('menu')).toBeVisible();
  if (state.endsWith('methods') || state.includes('login-font20')) {
    await expect(page.getByRole('dialog', { name: '添加 / 更新 Claude Code 账户', exact: true })).toBeVisible();
  }
  await expect.poll(() => page.locator('.ant-modal:visible, .ant-dropdown:visible').evaluateAll(popups =>
    popups.some(popup => /(?:zoom|slide-up)-(?:appear|enter|leave)/.test(popup.className)))).toBe(false);
  await page.screenshot({ path: info.outputPath(`${state}.png`), animations: 'disabled' });
}
async function loginMethods(page: Page, info: TestInfo, mode: string) {
  const dialog = page.getByRole('dialog', { name: '添加 / 更新 Claude Code 账户', exact: true });
  await expect(dialog.getByRole('button', { name: '通过官方 CLI 登录' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '浏览器授权码登录' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '导入本机账户' })).toBeVisible();
  await capture(page, info, `${mode}-methods`);
  await dialog.getByRole('button', { name: '通过官方 CLI 登录' }).click();
  const browserMode = page.getByRole('dialog', { name: '选择浏览器模式', exact: true });
  await expect(browserMode).toBeVisible();
  const normal = browserMode.getByRole('button', { name: '普通窗口', exact: true });
  const privateWindow = browserMode.getByRole('button', { name: '无痕窗口', exact: true });
  await capture(page, info, `${mode}-browser-modes`);
  expect((await normal.boundingBox())!.x).toBeLessThan((await privateWindow.boundingBox())!.x);
  await normal.click();
  await expect(browserMode).toBeHidden();
  await expect(dialog.getByRole('button', { name: '打开授权页面' })).toBeVisible();
  await capture(page, info, `${mode}-cli`);
  await dialog.getByRole('button', { name: '更换登录方式' }).click();
  await dialog.getByRole('button', { name: '浏览器授权码登录' }).click();
  await expect(browserMode).toBeVisible();
  await privateWindow.click();
  await expect(dialog.getByRole('textbox', { name: '授权链接', exact: true })).toBeVisible();
  await capture(page, info, `${mode}-private-manual`);
  await expect(dialog.getByText(/非官方集成，兼容性不保证/)).toBeVisible();
  await dialog.getByRole('textbox', { name: '授权码或回调链接' }).fill('wrong#state');
  await dialog.getByRole('button', { name: '验证并保存' }).click();
  await expect(dialog.getByText(/授权信息与本次登录不一致/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '验证并保存' })).not.toHaveClass(/ant-btn-loading/);
  await capture(page, info, `${mode}-pkce-error`);
  await dialog.getByRole('textbox', { name: '授权码或回调链接' }).fill('mock-code#mock-state');
  await dialog.getByRole('button', { name: '验证并保存' }).click();
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('codex-switch:language', 'zh');
    localStorage.setItem('codex-switch:account-display-mode', 'table');
    window.open = () => null;
  });
});

test('desktop local: sources, original Codex modal and both Claude login methods', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: '账户管理', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: '账户来源' })).toBeVisible();
  await expect(page.getByText('Claude Code', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '添加/更新账户', exact: true }).click();
  await capture(page, info, 'desktop-local-source-menu');
  await page.getByRole('menuitem', { name: 'Codex', exact: true }).click();
  await expect(page.locator('.modal-backdrop .modal')).toBeVisible();
  await capture(page, info, 'desktop-local-codex-modal');
  await page.locator('.modal-backdrop .modal-close').click();
  await page.getByRole('button', { name: '添加/更新账户', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click();
  await loginMethods(page, info, 'desktop-local');
  const row = page.locator('tr[data-row-key^="claude_"]');
  await row.click({ button: 'right' });
  await expect(page.locator('.account-row-context-menu')).toBeVisible();
  await capture(page, info, 'desktop-local-context');
  await page.keyboard.press('Escape');
  await expect(page.locator('.account-row-context-menu')).toBeHidden();
  await row.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true,
    button: 0, clientX: 420, clientY: 400 });
  await expect(page.locator('.account-row-context-menu')).toBeVisible();
  await row.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, isPrimary: true });
  await capture(page, info, 'desktop-local-touch-menu');
  await page.locator('.account-row-context-menu').getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('menuitem', { name: '重新授权' }).click();
  const reauthorize = page.getByRole('dialog', { name: '添加 / 更新 Claude Code 账户', exact: true });
  await expect(reauthorize.getByRole('button', { name: '通过官方 CLI 登录' })).toBeVisible();
  await reauthorize.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 900, height: 850 });
  await page.evaluate(() => localStorage.setItem('codex-switch:global-font-size', '20'));
  await page.reload();
  await page.getByRole('button', { name: '账户管理', exact: true }).click();
  await page.getByRole('button', { name: '添加/更新账户', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click();
  await expect(page.getByRole('button', { name: '通过官方 CLI 登录' })).toBeVisible();
  await capture(page, info, 'desktop-local-narrow-font20');
  await page.getByRole('button', { name: '通过官方 CLI 登录' }).click();
  await expect(page.getByRole('dialog', { name: '选择浏览器模式', exact: true })).toBeVisible();
  await capture(page, info, 'desktop-local-narrow-browser-modes');
});

test('remote account panel: manage connected computer and preserve typography', async ({ page }, info) => {
  await page.goto('/e2e/official-accounts-remote.html');
  await expect(page.getByRole('columnheader', { name: '账户来源' })).toBeVisible();
  await capture(page, info, 'desktop-remote-list');
  await page.getByRole('button', { name: '添加 / 更新 Claude Code 账户' }).click();
  await loginMethods(page, info, 'desktop-remote');
  await page.getByRole('button', { name: /^切\s*换$/ }).click();
  await expect(page.getByText(/新建会话将使用此账户/)).toBeVisible();
  await capture(page, info, 'desktop-remote-switched');
  await page.getByRole('button', { name: '取消默认账户' }).click();
  await page.getByRole('button', { name: '删除账户', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除账户', exact: true })).toBeVisible();
  await capture(page, info, 'desktop-remote-delete-confirmation');
  await page.getByRole('dialog', { name: '删除账户', exact: true }).getByRole('button', { name: /取\s*消/ }).click();
  await page.getByRole('button', { name: '重新授权' }).click();
  await expect(page.getByRole('button', { name: '通过官方 CLI 登录' })).toBeVisible();
  await page.getByRole('dialog', { name: '添加 / 更新 Claude Code 账户', exact: true })
    .getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '添加 / 更新 Claude Code 账户' }).click();
  await page.getByRole('button', { name: '导入本机账户' }).click();
  await expect(page.getByRole('dialog', { name: '添加 / 更新 Claude Code 账户', exact: true })).toBeHidden();
  await page.setViewportSize({ width: 900, height: 850 });
  await page.goto('/e2e/official-accounts-remote.html?dark&font=20');
  await capture(page, info, 'desktop-remote-dark-font20');
  await page.getByRole('button', { name: '添加 / 更新 Claude Code 账户' }).click();
  await capture(page, info, 'desktop-remote-dark-login-font20');
  await page.getByRole('button', { name: '通过官方 CLI 登录' }).click();
  await expect(page.getByRole('dialog', { name: '选择浏览器模式', exact: true })).toBeVisible();
  await capture(page, info, 'desktop-remote-dark-browser-modes');
});

test('web desktop: shared source menu and host-owned Claude accounts', async ({ page }, info) => {
  await page.goto('/e2e/official-accounts-web.html');
  await expect(page.getByText('账户来源: Codex')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '账户来源' })).toBeVisible();
  await capture(page, info, 'web-desktop-accounts');
  await page.locator('.official-account-add').click();
  await capture(page, info, 'web-desktop-source-menu');
  await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click();
  await loginMethods(page, info, 'web-desktop');
  await page.setViewportSize({ width: 900, height: 850 });
  await page.goto('/e2e/official-accounts-web.html?font=20');
  await capture(page, info, 'web-narrow-font20');
  await page.locator('.official-account-add').click();
  await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click();
  await capture(page, info, 'web-narrow-login-font20');
  await page.getByRole('button', { name: '通过官方 CLI 登录' }).click();
  await expect(page.getByRole('dialog', { name: '选择浏览器模式', exact: true })).toBeVisible();
  await capture(page, info, 'web-narrow-browser-modes');
  await page.getByRole('button', { name: '普通窗口', exact: true }).click();
  await page.getByRole('button', { name: '更换登录方式' }).click();
  await page.evaluate(async () => {
    const fixture = '/e2e/official-accounts-fixture.ts';
    const { setFixtureLanguage }: { setFixtureLanguage: (language: string) => void } = await import(fixture);
    setFixtureLanguage('en');
  });
  await expect(page.getByRole('button', { name: 'Sign in with the official CLI' })).toBeVisible();
  await capture(page, info, 'web-english-login');
});

test('desktop local: dark account cards show source and Claude actions', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('codex-switch:account-display-mode', 'cards'));
  await page.goto('/');
  await page.getByRole('button', { name: '账户管理', exact: true }).click();
  await page.getByRole('button', { name: '切换到暗黑主题' }).click();
  const card = page.locator('article[data-account-id^="claude_"]');
  await expect(card.getByText('Claude Code', { exact: true })).toBeVisible();
  await capture(page, info, 'desktop-local-dark-cards');
  await card.getByRole('button', { name: '更多操作' }).click();
  await expect(page.getByRole('menuitem', { name: '重新授权' })).toBeVisible();
  await capture(page, info, 'desktop-local-dark-card-actions');
});
