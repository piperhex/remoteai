import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockDiscoverySshStore } from '../../web/e2e/discovery-ssh-store';
import { checkProfileActions, checkSessionMenu } from './ssh-workspace-actions';

async function expectMonitorBelowTerminal(workspace: Locator) {
  const [terminal, monitor, sidebar, region] = await Promise.all([
    workspace.locator('.sshw-console').boundingBox(),
    workspace.locator('.sshw-monitor').boundingBox(),
    workspace.locator('.sshw-files:visible, .sshw-profiles:visible').boundingBox(),
    workspace.boundingBox(),
  ]);
  if (!terminal || !monitor || !sidebar || !region) throw new Error('Missing SSH workspace panels');
  expect(monitor.x).toBe(terminal.x);
  expect(monitor.width).toBe(terminal.width);
  expect(monitor.y).toBe(terminal.y + terminal.height);
  expect(sidebar.y + sidebar.height).toBe(region.y + region.height);
  expect(monitor.y + monitor.height).toBe(region.y + region.height);
}

async function uploadAndRead(page: Page, workspace: Locator, mode: string) {
  const name = mode + '-' + crypto.randomUUID().slice(0, 6) + '.txt';
  const picker = page.waitForEvent('filechooser');
  await workspace.getByRole('button', { name: '上传文件', exact: true }).click();
  await (await picker).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('SSH workspace file transfer\n') });
  await expect(workspace.getByText(name, { exact: true }).first()).toBeVisible();
  await workspace.locator('.xterm-helper-textarea:visible').focus();
  await page.keyboard.type('cat ' + name);
  await page.keyboard.press('Enter');
  await expect(workspace.locator('.xterm-rows:visible')).toContainText('SSH workspace file transfer');
}

test.skip(!process.env.SSH_FIXTURE_CONFIG, 'Requires the disposable WSL SSH server and Rust bridge');
for (const mode of ['local', 'remote', 'web']) {
  test(`${mode} opens a saved SSH terminal with its files and retains it across navigation`, async ({ page, request }, info) => {
    test.setTimeout(150_000);
    const bridge = 'http://127.0.0.1:1498';
    const fixture = await (await request.get(bridge + '/config')).json();
    await request.post(bridge + '/reset');
    const endpoint = { host: fixture.host, port: fixture.port };
    const probe = await (await request.post(bridge + '/rpc', { data: { type: 'probe', endpoint } })).json();
    expect(typeof probe.data).toBe('string');
    const profile = { ...endpoint, id: 'dev', name: '开发服务器', username: fixture.username,
      auth: 'password' as const, revision: 1, fingerprint: probe.data };
    const store = await mockDiscoverySshStore(page, [profile,
      { ...profile, id: 'build', name: '构建服务器', host: 'build.example.test' },
      { ...profile, id: 'backup', name: '备份服务器', host: 'backup.example.test' }]);
    store.secrets.set(profile.id, { password: fixture.password });
    await page.addInitScript(() => { Object.assign(window, { __TAURI_INTERNALS__: {} }); });
    await page.setViewportSize({ width: mode === 'remote' ? 1040 : 1440, height: 900 });
    await page.goto('/e2e/ssh-harness.html?workspace&mode=' + mode + (mode === 'remote' ? '&dark' : ''),
      { waitUntil: 'domcontentloaded' });
    const nav = page.locator('.sidebar-tabs');
    await nav.getByRole('button', { name: 'SSH', exact: true }).click();
    const workspace = page.getByRole('region', { name: 'SSH', exact: true });
    await expect(workspace.locator('.ssh-profile-card')).toHaveCount(3);
    await page.screenshot({ path: info.outputPath(mode + '-home.png'), animations: 'disabled' });
    const search = workspace.getByRole('textbox', { name: '搜索名称、地址或用户名' });
    await search.fill('开发');
    await expect(workspace.locator('.ssh-profile-card')).toHaveCount(1);
    await workspace.locator('.ssh-profile-card').click();
    const tty = workspace.locator('.xterm-rows:visible');
    await expect(tty).toContainText('wsl-ssh>', { timeout: 25_000 });
    await expect(workspace.getByRole('textbox', { name: '远程路径' })).toHaveValue('/');
    await expect(workspace.getByText('hello.txt', { exact: true }).first()).toBeVisible();
    await uploadAndRead(page, workspace, mode);
    const monitor = workspace.locator('.sshw-monitor');
    await expect(monitor.locator('[data-speed="download"]')).toHaveText(/\d (?:B|KB|MB|GB|TB|PB)\/s$/);
    await expect(monitor.locator('[data-speed="upload"]')).toHaveText(/\d (?:B|KB|MB|GB|TB|PB)\/s$/);
    await expect(monitor.locator('.sshm-values > span').first()).toContainText(/CPU\d+%/);
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expectMonitorBelowTerminal(workspace);
    await page.screenshot({ path: info.outputPath(mode + '-connected.png'), animations: 'disabled' });
    await workspace.locator('.sshw-switch').getByRole('button', { name: '已保存的连接' }).click();
    await expect(workspace.locator('.sshw-profiles')).toBeVisible();
    await expectMonitorBelowTerminal(workspace);
    await page.screenshot({ path: info.outputPath(mode + '-saved.png'), animations: 'disabled' });
    const capture = async (state: string) => {
      const popup = page.locator('.ant-dropdown:visible, .ant-modal:visible').last();
      await expect(popup).toBeVisible();
      await expect(popup).not.toHaveClass(/-(?:appear|enter|leave)(?:\s|$|-)/);
      await expect(popup).toHaveCSS('opacity', '1');
      await page.screenshot({ path: info.outputPath(mode + '-' + state + '.png'), animations: 'disabled' });
    };
    await checkProfileActions(page, workspace, capture);
    await checkSessionMenu(page, workspace, capture);
    await nav.getByRole('button', { name: 'Agent Hub' }).click();
    await nav.getByRole('button', { name: 'SSH', exact: true }).click();
    await expect(tty).toContainText('SSH workspace file transfer');
    await workspace.locator('.sshw-home-tab').click();
    await expect(monitor).toHaveCount(0);
    await expect(workspace.locator('.sshw-quick h3')).toHaveText('最近');
    await workspace.locator('.sshw-quick button').first().click();
    await expect(workspace.getByRole('tab')).toHaveCount(2);
    await expect(tty).toContainText('wsl-ssh>');
    await expect(monitor.locator('[data-speed="download"]')).toHaveText(/\/s$/);
    await page.setViewportSize({ width: 1040, height: 800 });
    await page.evaluate(() => {
      localStorage.setItem('codex-switch:global-font-size', '20');
      window.dispatchEvent(new Event('codex-switch:gui-appearance-changed'));
    });
    await expectMonitorBelowTerminal(workspace);
    await page.screenshot({ path: info.outputPath(mode + '-two-tabs-large.png'), animations: 'disabled' });
    await workspace.getByRole('button', { name: '关闭终端 2', exact: true }).click();
    await expect(workspace.getByRole('tab')).toHaveCount(1);
    await expect(tty).toContainText('SSH workspace file transfer');
    await workspace.getByRole('button', { name: '关闭终端 1', exact: true }).click();
    await expect(workspace.locator('.sshw-launch')).toBeVisible();
  });
}
