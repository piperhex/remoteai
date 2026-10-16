import { expect, test, type Page } from '@playwright/test';
import { navigate } from './chat-helpers';

async function closeSheet(page: Page) {
  const back = page.getByRole('button', { name: '返回上一层', exact: true });
  if (await back.isVisible()) await back.click();
  else await page.locator('.ant-modal-close:visible, .sheet-close[aria-label="关闭"]:visible').click();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const selector of ['.adaptive-sheet-content', '.account-details', '.verification-card']) {
    const fits = await page.locator(selector).evaluateAll(nodes =>
      nodes.every(node => node.scrollWidth <= node.clientWidth + 1));
    expect(fits).toBe(true);
  }
}

test.beforeEach(async ({ page, request }) => {
  await request.post('http://127.0.0.1:1491/test/reset');
  await page.goto('./');
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('review@example.test');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-review');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await page.getByRole('button', { name: '同意并登录' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByText('欢迎回来', { exact: true })).toBeVisible();
  await expect(page.getByText('欢迎回来', { exact: true })).toBeHidden();
});

test('revokes unattended access only after confirmation and keeps the prompt compact', async ({ page }, info) => {
  let requests = 0;
  await page.route('**/devices/sample-pc/service-credential', async route => {
    expect(route.request().method()).toBe('DELETE');
    requests += 1;
    await route.fulfill({ status: 204 });
  });
  await navigate(page, '设备');
  const openPrompt = async () => {
    await page.getByRole('button', { name: '我的工作电脑 的更多操作' }).click();
    await page.getByRole('menuitem', { name: '撤销无人值守授权' }).click();
    await expect(page.getByText('撤销无人值守授权？', { exact: true })).toBeVisible();
    await expect(page.getByRole('menu')).toBeHidden();
  };
  await openPrompt();
  const width = await page.locator('.adm-dialog-body').evaluate(element => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(400);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('revoke-unattended.png') });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(requests).toBe(0);
  await openPrompt();
  await page.getByRole('button', { name: '撤销授权', exact: true }).click();
  await expect(page.getByText('无人值守授权已撤销', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('account overview, private details, 2FA, and nested sheets', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await navigate(page, '账号');
  await expect(page.locator('.account-row')).toHaveCount(4);
  await expect(page.locator('.account-row').first()).not.toContainText('alex@example.test');
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('accounts.png') });
  await page.getByRole('button', { name: '显示账号邮箱' }).click();
  await expect(page.locator('.account-row').first()).toContainText('alex@example.test');
  await page.getByRole('button', { name: 'alex@example.test 的账号信息' }).click();
  await expect(page.getByRole('button', { name: '复制当前验证码', exact: true })).toHaveText(/\d{6}/);
  await expect(page.locator('.account-info-row').filter({ hasText: '到期时间' })).toContainText('2027-10-01');
  await page.screenshot({ path: info.outputPath('account-details-top.png') });
  await expect(page.locator('.account-info-row').filter({ hasText: '密码' })).not.toContainText('sample-password');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(page.locator('.account-info-row').filter({ hasText: '密码' })).toContainText('sample-password');
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
  await page.screenshot({ path: info.outputPath('account-details.png') });
  await page.getByRole('button', { name: '查看完整备注' }).click();
  await expect(page.locator('.account-full-note')).toContainText('完整内容');
  await closeSheet(page);
  await page.getByRole('button', { name: '查看重置卡详情' }).click();
  await expect(page.locator('.reset-credit-summary')).toContainText('1 张');
  await page.getByRole('button', { name: '使用重置卡', exact: true }).click();
  await expect(page.getByText('确认使用重置卡？')).toBeVisible();
  await page.getByText('取消', { exact: true }).click();
  await expect(page.locator('.reset-credit-summary')).toContainText('1 张');
  await closeSheet(page);
  await page.getByRole('button', { name: '编辑账号信息' }).click();
  await expect(page.getByRole('button', { name: '保存账号信息' })).toBeVisible();
  await closeSheet(page);
  await expect(page.getByRole('button', { name: '复制当前验证码', exact: true })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('one-click quota consumption stays compact, reports progress and refreshes usage', async ({ page }, info) => {
  await navigate(page, '账号');
  const ids: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/sync/accounts/*/quota/consume', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON().requestId).toMatch(/^[0-9a-f-]{36}$/);
    const id = route.request().url().split('/').at(-3)!;
    ids.push(id);
    await gate;
    if (id === 'account-1') await route.fulfill({ status: 502, json: { message: '未确认完成' } });
    else await route.fulfill({ json: { consumed: id !== 'account-3', skipped: id === 'account-3' } });
  });
  let usageRequests = 0;
  await page.route('**/sync/accounts/*/usage', async route => {
    usageRequests++;
    if (route.request().url().includes('account-2')) {
      await route.fulfill({ status: 500, json: { message: '查询失败' } });
    } else await route.fulfill({ json: { primary: { remainingPercent: 42, usedPercent: 58 } } });
  });
  const button = page.getByRole('button', { name: '一键消耗', exact: true });
  await expect(button).toBeVisible();
  await expect(page.getByText('全部账号额度消耗', { exact: true })).toHaveCount(0);
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toContainText('消耗中… 0/4');
  await expect.poll(() => ids.length).toBe(4);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('quota-progress.png') });
  release();
  await expect(page.getByText('完成：成功 2，未确认 1，跳过 1；1 个账号用量刷新失败')).toBeVisible();
  await expect(button).toBeEnabled();
  expect(new Set(ids).size).toBe(4);
  expect(ids.length).toBe(4);
  expect(usageRequests).toBe(4);
  await expect(page.locator('.account-row').first()).toContainText('42%');
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('quota-completed.png') });
});

test('quota progress survives navigation and cannot be started twice', async ({ page }) => {
  await navigate(page, '账号');
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/sync/accounts/*/quota/consume', async route => {
    calls++;
    await gate;
    await route.fulfill({ json: { consumed: true, skipped: false } });
  });
  await page.getByRole('button', { name: '一键消耗', exact: true }).click();
  await expect.poll(() => calls).toBe(4);
  await navigate(page, '设备');
  await navigate(page, '账号');
  await expect(page.getByRole('button', { name: '一键消耗', exact: true })).toBeDisabled();
  release();
  await expect(page.getByText('完成：成功 4，未确认 0，跳过 0')).toBeVisible();
  expect(calls).toBe(4);
});

test('quota consumption limits concurrency and stops queued accounts on logout', async ({ page }) => {
  await navigate(page, '账号');
  await page.route('**/sync/accounts/web-summary', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const sample = payload.accounts[0];
    await route.fulfill({ json: { accounts: Array.from({ length: 9 }, (_, index) => ({
      ...sample, id: `extra-${index}`, email: `extra-${index}@example.test`,
    })) } });
  });
  await page.route('**/sync/accounts/*/usage', route => route.fulfill({ json: {} }));
  await page.getByRole('button', { name: '批量刷新用量', exact: true }).click();
  await expect(page.locator('.account-row')).toHaveCount(9);
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/sync/accounts/*/quota/consume', async route => {
    calls++;
    await gate;
    await route.fulfill({ json: { consumed: true, skipped: false } });
  });
  await page.getByRole('button', { name: '一键消耗', exact: true }).click();
  await expect.poll(() => calls).toBe(4);
  await navigate(page, '设置');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.locator('.adm-dialog').getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录并查看' })).toBeVisible();
  release();
  await expect(page.getByText('登录状态已改变，已停止消耗', { exact: true })).toBeVisible();
  expect(calls).toBe(4);
});

test('2FA search, sorting, eight digits, editing and failed clipboard', async ({ page }, info) => {
  await navigate(page, '2FA');
  await page.getByRole('button', { name: '同步 2FA 密钥', exact: true }).click();
  await expect(page.locator('.verification-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '复制 AWS 验证码', exact: true })).toContainText(/\d{4} \d{4}/);
  await page.getByRole('textbox', { name: '搜索服务名称或账号' }).fill('review-1');
  await expect(page.locator('.verification-card')).toHaveCount(1);
  await expect(page.locator('.verification-card h2')).toHaveText('OpenAI');
  await page.getByRole('textbox', { name: '搜索服务名称或账号' }).fill('missing');
  await expect(page.getByText('没有找到匹配的账号')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索服务名称或账号' }).fill('');
  await page.getByRole('button', { name: '验证码排序' }).click();
  await page.getByRole('menuitem', { name: '按服务名称' }).click();
  await expect(page.locator('.verification-card h2').first()).toHaveText('AWS');
  await page.getByRole('heading', { name: '2FA 验证码' }).click();
  await expect(page.getByText('已获取云端 2FA 密钥', { exact: true })).toBeHidden();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('totp.png') });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('denied'); } },
  }));
  await page.getByRole('button', { name: '复制 AWS 验证码', exact: true }).click();
  await expect(page.getByText('复制失败，请重试')).toBeVisible();
  await page.getByRole('button', { name: '管理 AWS 的 2FA 密钥' }).click();
  await page.getByRole('menuitem', { name: '编辑密钥' }).click();
  await expect(page.getByRole('textbox', { name: '服务名称', exact: true })).toHaveValue('AWS');
  await page.getByRole('button', { name: '保存密钥' }).click();
  await expect(page.getByRole('button', { name: '复制 AWS 验证码', exact: true })).toContainText(/\d{4} \d{4}/);
});

test('grouped settings, persisted interval, shared sync and about', async ({ page }, info) => {
  await navigate(page, '设置');
  await page.screenshot({ path: info.outputPath('settings.png') });
  await page.getByRole('button', { name: /自动刷新用量/ }).click();
  await page.getByRole('textbox', { name: '刷新间隔（分钟）' }).fill('0');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1 到 1440');
  await page.getByRole('textbox', { name: '刷新间隔（分钟）' }).fill('15');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: /自动刷新用量/ })).toContainText('15 分钟');
  await page.getByRole('button', { name: /2FA 密钥 未开启/ }).click();
  await page.getByRole('switch', { name: '云端同步' }).click();
  await closeSheet(page);
  await expect(page.getByRole('button', { name: /2FA 密钥 已开启/ })).toBeVisible();
  await page.getByRole('button', { name: /关于 Remote AI/ }).click();
  await expect(page.getByText('Web 浏览器')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('about.png') });
  await page.getByRole('button', { name: '返回设置' }).click();
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.getByRole('textbox', { name: '新密码', exact: true }).fill('draft-password');
  await closeSheet(page);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '新密码', exact: true })).toHaveValue('');
  await closeSheet(page);
  await navigate(page, '2FA');
  await expect(page.locator('.verification-card')).toHaveCount(3);
  await page.reload();
  await navigate(page, '设置');
  await expect(page.getByRole('button', { name: /自动刷新用量/ })).toContainText('15 分钟');
});

test('slow refresh stays responsive and only one refresh runs', async ({ page }) => {
  await navigate(page, '账号');
  let calls = 0;
  let release: () => void = () => undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/sync/accounts/web-summary', async route => {
    calls += 1;
    await pending;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: '批量刷新用量' }).click();
    await expect(page.getByRole('button', { name: '批量刷新用量' })).toBeDisabled();
    await navigate(page, '设置');
    await page.getByRole('button', { name: /关于 Remote AI/ }).click();
    await expect(page.getByText('Web 浏览器')).toBeVisible();
    expect(calls).toBe(1);
  } finally { release(); }
});

test('device model targets keep their selections separate', async ({ page }, info) => {
  await navigate(page, '设备');
  const open = async () => page.locator('.device-card').filter({ hasText: '我的工作电脑' })
    .getByRole('button', { name: /切换模型/ }).click();
  await open();
  await expect(page.getByRole('button', { name: '代理接口模型', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /alex@example.test 官方模型/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /工作分组 同时启用/ })).toBeVisible();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  await expect(page.getByRole('button', { name: /studio@example.test 官方模型/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /工作分组 同时启用/ })).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('gui-model-switch.png') });
  const guiRequest = page.waitForRequest('**/devices/sample-pc/gui-provider');
  await page.getByRole('button', { name: /测试 Provider test-model/ }).click();
  expect((await guiRequest).postDataJSON()).toEqual({ providerId: 'provider-1' });
  await expect(page.getByText('Codex GUI 模型已切换', { exact: true })).toBeVisible();
  await open();
  await expect(page.getByRole('button', { name: /alex@example.test 官方模型/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  await expect(page.getByRole('button', { name: /测试 Provider test-model/ })).toBeDisabled();
  const accountRequest = page.waitForRequest('**/devices/sample-pc/gui-account');
  await page.getByRole('button', { name: /studio@example.test 官方模型/ }).click();
  expect((await accountRequest).postDataJSON()).toEqual({ accountId: 'account-1' });
  await open();
  const proxyRequest = page.waitForRequest('**/devices/sample-pc/provider');
  await page.getByRole('button', { name: /测试 Provider test-model/ }).click();
  await proxyRequest;
  await open();
  await expect(page.getByRole('button', { name: /测试 Provider test-model/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  await expect(page.getByRole('button', { name: /studio@example.test 官方模型/ })).toBeDisabled();
});

test('pending GUI switch prevents duplicate actions and a failure preserves the selection', async ({ page }) => {
  await navigate(page, '设备');
  await page.locator('.device-card').filter({ hasText: '我的工作电脑' })
    .getByRole('button', { name: /切换模型/ }).click();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  let calls = 0;
  let release: () => void = () => undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/devices/sample-pc/gui-provider', async route => {
    calls += 1;
    await pending;
    await route.fulfill({ status: 409, json: { message: '此账户已不可用，请重新选择。' } });
  });
  try {
    await page.getByRole('button', { name: /测试 Provider test-model/ }).click();
    await expect(page.getByRole('button', { name: '代理接口模型', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /alex@example.test 官方模型/ })).toBeDisabled();
    await expect(page.getByText('切换中', { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    await noOverflow(page);
  } finally { release(); }
  await expect(page.getByText('此账户已不可用，请重新选择。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /测试 Provider test-model/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /studio@example.test 官方模型/ })).toBeDisabled();
});

test('aggregate selections keep GUI and proxy targets independent', async ({ page }, info) => {
  await navigate(page, '设备');
  const open = async () => page.locator('.device-card').filter({ hasText: '我的工作电脑' })
    .getByRole('button', { name: /切换模型/ }).click();
  await open();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  const guiRequest = page.waitForRequest('**/devices/sample-pc/gui-aggregate');
  await page.getByRole('button', { name: /聚合测试 public-model/ }).click();
  expect((await guiRequest).postDataJSON()).toEqual({ aggregateId: 'route-1' });
  await open();
  await expect(page.getByRole('button', { name: /alex@example.test 官方模型/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  await expect(page.getByRole('button', { name: /聚合测试 public-model/ })).toBeDisabled();
  await page.getByRole('button', { name: '代理接口模型', exact: true }).click();
  const proxyRequest = page.waitForRequest('**/devices/sample-pc/aggregate');
  await page.getByRole('button', { name: /聚合测试 public-model/ }).click();
  expect((await proxyRequest).postDataJSON()).toEqual({ aggregateId: 'route-1' });
  await open();
  await expect(page.getByRole('button', { name: /聚合测试 public-model/ })).toBeDisabled();
  await page.getByRole('button', { name: /聚合测试 public-model/ }).scrollIntoViewIfNeeded();
  await expect(page.getByText('代理接口模型已切换', { exact: true })).toBeHidden();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('aggregate-model-selection.png'), animations: 'disabled' });
});
