import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockDiscoverySshStore } from '../../web/e2e/discovery-ssh-store';
import { checkProfileActions, checkSessionMenu, expectCenteredProfileIcons } from './ssh-workspace-actions';

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

async function resizeFiles(page: Page, workspace: Locator, screenshot: string) {
  const rail = workspace.locator('.sshw-rail');
  const handle = rail.getByRole('separator', { name: '远程文件浏览', exact: true });
  const screen = workspace.locator('.xterm-screen:visible');
  const width = (element: Locator) => element.evaluate(node => node.getBoundingClientRect().width);
  const initial = await width(rail);
  const terminalWidth = await width(screen);
  await handle.focus();
  await handle.press('ArrowLeft');
  await expect.poll(() => width(rail)).toBe(initial - 16);
  await handle.dblclick();
  await expect.poll(() => width(rail)).toBe(initial);
  const box = await handle.boundingBox();
  if (!box) throw new Error('Missing SSH sidebar divider');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y, { steps: 8 });
  await expect.poll(() => width(rail)).toBe(initial + 120);
  await expect.poll(() => width(screen)).toBeLessThan(terminalWidth - 100);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  await page.mouse.up();
  await expectMonitorBelowTerminal(workspace);
  return initial + 120;
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
    await search.fill('');
    const firstComputer = mode === 'local' ? 'Studio PC' : 'Workstation';
    const picker = page.getByRole('menu', { name: '选择电脑' });
    const row = workspace.locator('.ssh-profile-card').filter({ hasText: '开发服务器' });
    await row.locator('.sshw-profile-arrow').click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(picker.getByRole('menuitem', { name: /Offline PC/ })).toBeDisabled();
    await expect(workspace.getByRole('tab')).toHaveCount(0);
    const overlay = page.locator('.ant-dropdown:visible');
    await expect(overlay).not.toHaveClass(/-(?:appear|enter)(?:\s|$|-)/);
    const rowBounds = (await row.boundingBox())!;
    const menuBounds = (await picker.boundingBox())!;
    expect(Math.abs(menuBounds.x - rowBounds.x - rowBounds.width - 4)).toBeLessThan(1);
    expect(Math.abs(menuBounds.y - rowBounds.y)).toBeLessThan(1);
    await page.screenshot({ path: info.outputPath(mode + '-choose-device.png'), animations: 'disabled' });
    const filter = picker.getByRole('textbox');
    await filter.fill('missing');
    await expect(picker.getByRole('menuitem')).toHaveCount(0);
    await filter.fill('lap');
    await expect(picker.getByRole('menuitem')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await row.click();
    await picker.getByRole('menuitem', { name: new RegExp(firstComputer) }).click();
    await expect(workspace.getByRole('tab').locator('small')).toHaveText(firstComputer);
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
    const resizedWidth = await resizeFiles(page, workspace, info.outputPath(mode + '-dragging.png'));
    await workspace.locator('.sshw-switch').getByRole('button', { name: '已保存的连接' }).click();
    await expect(workspace.locator('.sshw-profiles')).toBeVisible();
    await expect(workspace.locator('.sshw-rail')).toHaveCSS('width', resizedWidth + 'px');
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
    await checkSessionMenu(page, workspace, capture, firstComputer);
    await nav.getByRole('button', { name: 'Agent Hub' }).click();
    await nav.getByRole('button', { name: 'SSH', exact: true }).click();
    await expect(tty).toContainText('SSH workspace file transfer');
    await workspace.locator('.sshw-home-tab').click();
    await expect(monitor).toHaveCount(0);
    await expect(workspace.locator('.sshw-quick h3')).toHaveText('最近');
    await workspace.locator('.sshw-quick button').first().click();
    await picker.getByRole('menuitem', { name: /Laptop/ }).click();
    await expect(workspace.getByRole('tab').locator('small')).toHaveText([firstComputer, 'Laptop']);
    await expect(workspace.getByRole('tab')).toHaveCount(2);
    await expect(tty).toContainText('wsl-ssh>');
    await expect(monitor.locator('[data-speed="download"]')).toHaveText(/\/s$/);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: info.outputPath(mode + '-two-computers.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1040, height: 800 });
    await page.evaluate(() => {
      localStorage.setItem('codex-switch:global-font-size', '20');
      window.dispatchEvent(new Event('codex-switch:gui-appearance-changed'));
    });
    await expectMonitorBelowTerminal(workspace);
    const tab = workspace.getByRole('tab').nth(1);
    const [title, origin, bounds] = await Promise.all([tab.locator('span > span').boundingBox(),
      tab.locator('small').boundingBox(), tab.boundingBox()]);
    expect(origin!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
    expect(origin!.y + origin!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    await page.screenshot({ path: info.outputPath(mode + '-two-tabs-large.png'), animations: 'disabled' });
    await workspace.getByRole('button', { name: '终端连接选项' }).click();
    await capture('session-menu-large');
    await expectCenteredProfileIcons(page.getByRole('menuitem', { name: /开发服务器/ }));
    await page.keyboard.press('Escape');
    await workspace.locator('.sshw-switch').getByRole('button', { name: '已保存的连接' }).click();
    await row.press('Enter');
    await expect(picker.getByRole('menuitem', { name: /Laptop/ })).toBeInViewport();
    await expect(overlay).not.toHaveClass(/-(?:appear|enter)(?:\s|$|-)/);
    await page.screenshot({ path: info.outputPath(mode + '-large-computer-menu.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await workspace.getByRole('button', { name: '关闭终端 2', exact: true }).click();
    await expect(workspace.getByRole('tab')).toHaveCount(1);
    await expect(tty).toContainText('SSH workspace file transfer');
    await workspace.getByRole('button', { name: '关闭终端 1', exact: true }).click();
    await expect(workspace.locator('.sshw-launch')).toBeVisible();
    await page.reload();
    await nav.getByRole('button', { name: 'SSH', exact: true }).click();
    const rail = workspace.locator('.sshw-rail');
    await expect(rail).toHaveCSS('width', resizedWidth + 'px');
    await rail.getByRole('separator').press('End');
    await expect(workspace.locator('.sshw-main')).toHaveCSS('width', '300px');
  });
}
