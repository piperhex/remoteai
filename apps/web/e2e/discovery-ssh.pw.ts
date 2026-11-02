import { expect, test } from '@playwright/test';
import { connect, fixtureUrl, login, navigate, operationCount, screenshot, state } from './chat-helpers';
import { testText } from '../../../scripts/i18n-fixture.mjs';
import { mockDiscoverySshStore } from './discovery-ssh-store';

test('saved SSH connections open directly from mobile Discover', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'Mobile discovery entry');
  await request.post(`${fixtureUrl}/test/reset`);
  const profiles = Array.from({ length: 12 }, (_, index) => ({
    id: `saved-${index}`, name: index ? `备份服务器 ${index}` : '开发服务器', host: `server-${index}.test`,
    port: 22, username: 'dev', auth: 'password', fingerprint: 'SHA256:fixture', revision: 1,
  }));
  let mode = 'saved';
  await page.route('**/sync/ssh-profiles**', async route => {
    if (route.request().url().endsWith('/credentials')) {
      await route.fulfill({ json: { credentials: { password: 'fixture-password' } } }); return;
    }
    await route.fulfill(mode === 'error' ? { status: 503, json: { message: 'client.ssh.loadFailed' } }
      : { json: mode === 'empty' ? [] : profiles });
  });
  await login(page); await connect(page);
  const draft = page.getByRole('textbox', { name: '聊天消息' });
  await draft.fill('保留聊天草稿');
  await navigate(page, '发现');
  await screenshot(page, info, 'web-mobile-light-discover');
  await page.locator('.discovery-list').getByRole('button', { name: 'SSH', exact: true }).click();
  const list = page.locator('.discovery-ssh-page');
  await expect(list.locator('.discovery-ssh-connection')).toHaveCount(12);
  await expect(list.locator('.discovery-ssh-connection').first()).toBeEnabled();
  await screenshot(page, info, 'web-mobile-light-ssh-list');
  await list.getByRole('button', { name: /备份服务器 11 / }).scrollIntoViewIfNeeded();
  await expect(list.getByRole('button', { name: /备份服务器 11 / })).toBeInViewport();
  await list.getByRole('button', { name: /开发服务器 / }).click();
  const terminal = page.getByRole('dialog', { name: '远程终端', exact: true });
  await expect(terminal).toBeVisible();
  await expect(page.locator('.xterm-rows')).toContainText('SSH ready');
  expect(await operationCount(request, 'guiTerminalOpen')).toBe(0);
  expect(await operationCount(request, 'guiTerminalSshOpen')).toBe(1);
  await page.locator('.xterm-helper-textarea').fill('echo discovery');
  await expect.poll(async () => (await state(request)).operations.filter(op => op.operation === 'guiTerminalWrite')
    .map(op => op.data).join('')).toContain('echo discovery');
  await screenshot(page, info, 'web-mobile-light-ssh-terminal');
  await terminal.getByRole('button', { name: '收起终端', exact: true }).click();
  await expect(terminal).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {
    key: 'codex-switch.web.theme.v1', newValue: 'dark',
  })));
  await screenshot(page, info, 'web-mobile-dark-ssh-list');
  mode = 'empty'; await list.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(list.getByText('还没有保存的连接', { exact: true })).toBeVisible();
  await screenshot(page, info, 'web-mobile-dark-ssh-empty');
  mode = 'error'; await list.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(list.getByRole('alert')).toBeVisible();
  await screenshot(page, info, 'web-mobile-dark-ssh-error');
  mode = 'saved'; await list.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(list.locator('.discovery-ssh-connection')).toHaveCount(12);
  await list.getByRole('button', { name: '返回发现', exact: true }).click();
  await expect(page.locator('.discovery-list')).toBeVisible();
  await navigate(page, '聊天'); await expect(draft).toHaveValue('保留聊天草稿');
});

test('saved connections stay visible without a computer and copy switches offline', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'Mobile discovery entry');
  await request.post(`${fixtureUrl}/test/reset`);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.route('**/devices', route => route.fulfill({ json: { devices: [] } }));
  await page.routeWebSocket('**/device-switch', socket => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: 'devices-snapshot', devices: [] })));
  });
  const store = await mockDiscoverySshStore(page, [{ id: 'offline',
    name: '已保存的服务器', host: 'saved.test', port: 22, username: 'dev', auth: 'password', revision: 1 }]);
  await login(page); await navigate(page, '发现');
  await page.locator('.discovery-list').getByRole('button', { name: 'SSH', exact: true }).click();
  const list = page.locator('.discovery-ssh-page');
  await expect(list.getByRole('button', { name: /已保存的服务器 / })).toBeEnabled();
  await list.getByRole('button', { name: '新建 SSH 连接', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('连接名称（可选）', { exact: true }).fill('新建服务器');
  await editor.getByLabel('IP 或主机名', { exact: true }).fill('new.test');
  await editor.getByLabel('用户名', { exact: true }).fill('dev');
  await screenshot(page, info, 'web-mobile-360-light-ssh-create');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(list.locator('.discovery-ssh-connection')).toHaveCount(2);
  expect(store.profiles.find(value => value.host === 'new.test')?.username).toBe('dev');
  await list.getByRole('button', { name: '编辑 新建服务器', exact: true }).click();
  await editor.getByLabel('连接名称（可选）', { exact: true }).fill('重命名服务器');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(list.getByRole('button', { name: '编辑 重命名服务器', exact: true })).toBeVisible();
  await page.context().setOffline(true);
  for (const language of ['en', 'ja', 'ru', 'zh']) {
    await page.evaluate(value => {
      localStorage.setItem('codex-switch.web.language.v1', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'codex-switch.web.language.v1' }));
    }, language);
    await expect(list.getByText(testText('client.discovery.sshComputerHint', {}, language))).toBeVisible();
    await expect(list.getByRole('button', { name: testText('client.ssh.editConnection',
      { name: '重命名服务器' }, language), exact: true })).toBeVisible();
  }
  await list.getByRole('button', { name: /已保存的服务器 / }).click();
  await expect(list.getByRole('status')).toBeVisible();
  await screenshot(page, info, 'web-mobile-360-light-ssh-offline');
  expect(await operationCount(request, 'guiTerminalSshOpen')).toBe(0);
  await list.getByRole('button', { name: '取消', exact: true }).click();
  await list.getByRole('button', { name: '返回发现', exact: true }).click();
  await expect(page.locator('.discovery-list')).toBeVisible();
});

test('mobile Discover edits credentials safely and keeps failed saves retryable', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'Mobile discovery editor');
  await request.post(`${fixtureUrl}/test/reset`);
  const store = await mockDiscoverySshStore(page, ['password', 'key'].map(auth => ({
    id: auth, name: auth === 'password' ? '密码服务器' : '私钥服务器', host: `${auth}.test`, port: 22,
    username: 'dev', auth: auth as 'password' | 'key', revision: 1, fingerprint: 'SHA256:fixture',
  })));
  store.secrets.set('password', { password: 'fixture-password' });
  store.secrets.set('key', { privateKey: 'fixture-key', passphrase: 'fixture-passphrase' });
  await login(page); await connect(page); await navigate(page, '发现');
  await page.locator('.discovery-list').getByRole('button', { name: 'SSH', exact: true }).click();
  const list = page.locator('.discovery-ssh-page');
  const editor = page.getByRole('dialog');
  await list.getByRole('button', { name: '编辑 密码服务器', exact: true }).click();
  await expect(editor.getByLabel('IP 或主机名', { exact: true })).toHaveValue('password.test');
  await expect(editor.getByLabel('密码', { exact: true })).toHaveValue('');
  await editor.getByLabel('连接名称（可选）', { exact: true }).fill('取消的修改');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  expect(store.writes).toHaveLength(0);
  await list.getByRole('button', { name: '编辑 密码服务器', exact: true }).click();
  await editor.getByLabel('连接名称（可选）', { exact: true }).fill('更新的密码服务器');
  await screenshot(page, info, 'web-mobile-light-ssh-edit');
  store.failSave = true;
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('连接配置未能保存到账号');
  const alertBox = await editor.getByRole('alert').boundingBox();
  const actionBox = await editor.locator('.ssh-dialog-actions').boundingBox();
  expect(alertBox).toBeTruthy(); expect(actionBox).toBeTruthy();
  expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(actionBox!.y);
  await expect(editor.getByLabel('连接名称（可选）', { exact: true })).toHaveValue('更新的密码服务器');
  await screenshot(page, info, 'web-mobile-light-ssh-save-error');
  store.failSave = false;
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toBeHidden();
  expect(store.writes[0].credentials).toBeUndefined();
  expect(store.secrets.get('password')).toEqual({ password: 'fixture-password' });
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {
    key: 'codex-switch.web.theme.v1', newValue: 'dark',
  })));
  await list.getByRole('button', { name: '编辑 私钥服务器', exact: true }).click();
  await expect(editor.getByLabel('私钥', { exact: true })).toHaveValue('');
  await editor.getByLabel('连接名称（可选）', { exact: true }).fill('更新的私钥服务器');
  await screenshot(page, info, 'web-mobile-dark-ssh-edit-key');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toBeHidden();
  expect(store.writes[1].credentials).toBeUndefined();
  expect(store.secrets.get('key')).toEqual({ privateKey: 'fixture-key', passphrase: 'fixture-passphrase' });
  expect(await operationCount(request, 'guiTerminalSshOpen')).toBe(0);
  for (const name of ['更新的密码服务器', '更新的私钥服务器']) {
    await list.locator('.discovery-ssh-connection').filter({ hasText: name }).click();
    const terminal = page.getByRole('dialog', { name: '远程终端', exact: true });
    await expect(page.locator('.xterm-rows')).toContainText('SSH ready');
    await terminal.getByRole('button', { name: '收起终端', exact: true }).click();
  }
  expect(await operationCount(request, 'guiTerminalSshOpen')).toBe(2);
  await screenshot(page, info, 'web-mobile-dark-ssh-updated-list');
});
