import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { WebSocketServer, type WebSocketServer as Server } from 'ws';
import type { AddressInfo } from 'node:net';
import { ChatSessionsFixture } from '../../../shared/testing/chatSessions.mjs';
import type { desktopTest } from '../../web/e2e/remote-desktop-fixture';
import './chat-harness-types';
import { checkGitDiffReview } from './git-diff-checks';
import { checkRemoteFileDrop } from './file-drop-checks';
import { checkThreadSidebarResize } from './thread-sidebar-resize';
import { checkRemoteTiming } from './remote-timing-checks';
import { checkRemoteHistory } from './remote-history-checks';
import { checkRemoteWindowLayout } from './remote-window-layout';
import { checkModelAvailability } from './model-availability-checks';

declare global { interface Window { desktopTest: typeof desktopTest } }

let server: Server;
let endpoint: string;

test.beforeEach(async () => {
  const sessions = new ChatSessionsFixture();
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('connection', socket => {
    let joined = false;
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString());
      if (joined) { sessions.route(socket, frame); return; }
      joined = true;
      const identity = { role: frame.role, deviceId: frame.deviceId, ownerId: 'owner',
        expiresAt: Date.now() + 300_000 };
      sessions.join(socket, identity, frame, []);
    });
    socket.on('close', () => sessions.disconnect(socket));
  });
});
test.afterEach(async () => {
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function chooseComputer(page: Page, name: string) {
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  await page.getByRole('region', { name: '设备列表' }).getByRole('button', { name: new RegExp(name) }).click();
}

async function chooseHost(page: Page, name: string) {
  await page.getByRole('button', { name: /^切换主机：/ }).click();
  await page.getByRole('menu', { name: '主机列表' }).getByRole('menuitemradio', { name: new RegExp(name) }).click();
  await expect(page.getByRole('menu', { name: '主机列表' })).toBeHidden();
}

test('remote desktop preserves an unavailable model and restores sending after account recovery',
  async ({ context, page }) => {
    const host = await context.newPage();
    await host.goto('/e2e/chat-harness.html?role=desktop&demo&device=computer-one&blocked=true'
      + `&socket=${encodeURIComponent(endpoint)}`);
    await expect(host.locator('#status')).toHaveText('registered');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
    await chooseHost(page, 'Office PC');
    await expect(page.locator('.gui-remote-workspace:visible .chat-connection-status'))
      .toContainText('Relay', { timeout: 20_000 });
    const catalog = await host.evaluate(() => window.chatTest.demoState().composer.models);
    await checkModelAvailability(page, {
      restrict: () => host.evaluate(models => window.chatTest.setComposer({ models }), catalog.slice(1)),
      restore: () => host.evaluate(models => window.chatTest.setComposer({ models }), catalog),
      screenshot: '../../.codex-tmp/model-unavailable-remote.png',
    });
    expect(await host.evaluate(() => window.chatTest.demoState().operations
      .filter(operation => operation.operation === 'send').length)).toBe(0);
  });

for (const blocked of [false, true]) {
  test(`keeps a new remote message after immediately pausing over ${blocked ? 'Relay' : 'P2P'}`,
    async ({ context, page }) => {
      const host = await context.newPage();
      await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=computer-one&blocked=${blocked}`
        + `&socket=${encodeURIComponent(endpoint)}`);
      await expect(host.locator('#status')).toHaveText('registered');
      await page.bringToFront();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
      await chooseHost(page, 'Office PC');
      await expect(page.locator('.gui-remote-workspace:visible .chat-connection-status'))
        .toContainText(blocked ? 'Relay' : 'P2P', { timeout: 20_000 });
      await page.getByRole('button', { name: '新对话', exact: true }).click();
      const text = 'slow first message: keep after pause';
      await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(text);
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await page.getByRole('button', { name: '暂停生成', exact: true }).click();
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: '继续生成', exact: true })).toBeVisible();
      await page.screenshot({ path: `../../.codex-tmp/interrupted-send-remote-${blocked ? 'relay' : 'direct'}.png` });
    });
}

test('remote GUI can disable and restore message queuing while a turn is running', async ({ context, page }, info) => {
  test.setTimeout(90_000);
  const host = await context.newPage();
  await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=computer-one&blocked=false&title=Queue%20settings`
    + `&socket=${encodeURIComponent(endpoint)}`);
  await expect(host.locator('#status')).toHaveText('registered');
  await page.bringToFront();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await chooseHost(page, 'Office PC');
  await page.getByRole('button', { name: 'Queue settings', exact: true }).click();
  const input = page.getByRole('textbox', { name: '聊天消息', exact: true });
  await input.fill('slow queue settings');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: 'Codex GUI 设置', exact: true }).click();
  await page.getByRole('tab', { name: '消息发送', exact: true }).click();
  const toggle = page.getByRole('switch', { name: '待发送', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('dialog')).toHaveCSS('transform', 'none');
  await page.screenshot({ path: info.outputPath('remote-message-settings.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await input.fill('立即追加远程消息');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => host.evaluate(() => window.chatTest.demoState().operations
    .filter(operation => operation.operation === 'steer').map(operation => operation.text)))
    .toEqual(['立即追加远程消息']);
  await expect(page.getByRole('region', { name: '待发送消息', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: 'Codex GUI 设置', exact: true }).click();
  await page.getByRole('tab', { name: '消息发送', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await input.fill('恢复排队');
  await input.press('Enter');
  await expect(page.getByRole('region', { name: '待发送消息', exact: true })).toContainText('恢复排队');
});

test('remote GUI switches to Japanese without losing its connection or draft', async ({ context, page }, info) => {
  test.setTimeout(90_000);
  const host = await context.newPage();
  await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=computer-one&blocked=true&title=My%20project`
    + `&socket=${encodeURIComponent(endpoint)}`);
  await expect(host.locator('#status')).toHaveText('registered');
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await chooseComputer(page, 'Office PC');
  await page.getByRole('button', { name: 'My project', exact: true }).click();
  await expect(page.locator('.chat-connection-status')).toContainText('Relay');
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('保留草稿 / draft');
  const languageModule = fileURLToPath(new URL('../../../shared/localization/uiText.ts', import.meta.url));
  await page.evaluate(async module => {
    const { setGuiLanguage }: typeof import('../../../shared/localization/uiText') = await import(module);
    setGuiLanguage('ja');
  }, `/@fs/${languageModule.replaceAll('\\', '/')}`);
  await expect(page.getByRole('textbox', { name: 'チャットメッセージ', exact: true })).toHaveValue('保留草稿 / draft');
  await expect(page.getByRole('button', { name: 'メッセージを送信', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'ポートマッピング', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'リモートデスクトップを開く', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My project', exact: true })).toBeVisible();
  await expect(page.getByText('可以，今天先完成这三件事：', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('remote-gui-japanese.png') });
  await page.getByRole('button', { name: 'メッセージを送信', exact: true }).click();
  await expect.poll(() => host.evaluate(() => window.chatTest.demoState().operations
    .filter(operation => operation.operation === 'send').map(operation => operation.text))).toEqual(['保留草稿 / draft']);
});

test('keeps remote search in its header dialog without filtering the sidebar', async ({ context, page }) => {
  const host = await context.newPage();
  await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=computer-one&blocked=false&title=Search%20example`
    + `&socket=${encodeURIComponent(endpoint)}`);
  await expect(host.locator('#status')).toHaveText('registered');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await chooseHost(page, 'Office PC');
  const sidebar = page.locator('.gui-remote-sidebar:visible');
  await expect(sidebar.getByRole('textbox', { name: '搜索对话', exact: true })).toHaveCount(0);
  const trigger = sidebar.getByRole('button', { name: '搜索对话', exact: true });
  await expect(trigger).toBeEnabled();
  await page.screenshot({ path: '../../.codex-tmp/remote-search-sidebar.png' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '搜索聊天', exact: true });
  const search = dialog.getByRole('textbox', { name: '搜索聊天', exact: true });
  await expect(dialog).toBeVisible();
  await expect(search).toBeInViewport();
  await search.fill('不存在');
  await expect(dialog.getByText('没有找到相关聊天')).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Search example', exact: true })).toBeVisible();
  await search.fill('Search');
  await expect(dialog.getByRole('button', { name: 'Search example', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Search example', exact: true })).toBeInViewport();
  await page.screenshot({ path: '../../.codex-tmp/remote-search-dialog.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Search example', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Search example', exact: true })).toBeVisible();
  await trigger.click();
  await expect(search).toBeEmpty();
  await search.fill('不存在');
  await dialog.getByRole('button', { name: '清空搜索', exact: true }).click();
  await expect(search).toBeEmpty();
  await search.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(sidebar.getByRole('button', { name: 'Search example', exact: true })).toBeVisible();
});

test('remote chat sidebar resizes and restores its width after hiding and mobile layout',
  async ({ context, page }) => {
    test.setTimeout(90_000);
    const host = await context.newPage();
    await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=computer-one&blocked=false&title=Window%20layout`
      + `&socket=${encodeURIComponent(endpoint)}`);
    await expect(host.locator('#status')).toHaveText('registered');
    await host.evaluate(() => {
      window.chatTest.demoState().threads[0].turns![0].items.push({
        type: 'agentMessage', id: 'window-layout-long-message', text: '窗口布局检查。\n\n'.repeat(50),
      });
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
    await chooseHost(page, 'Office PC');
    await expect(page.locator('.gui-remote-workspace:visible .chat-connection-status'))
      .toContainText('P2P', { timeout: 20_000 });
    const ports = page.getByRole('button', { name: '端口映射', exact: true });
    const portsBounds = await ports.boundingBox();
    const desktopBounds = await page.getByRole('button', { name: '打开远程桌面' }).boundingBox();
    expect(portsBounds!.x + portsBounds!.width).toBeLessThan(desktopBounds!.x);
    await ports.click();
    const forwardingPanel = page.getByRole('region', { name: '端口映射设置' });
    await expect(forwardingPanel).toBeInViewport();
    await forwardingPanel.getByRole('button', { name: '新建映射', exact: true }).click();
    const remotePort = forwardingPanel.getByRole('spinbutton', { name: '远程端口' });
    await expect(remotePort).toBeEnabled();
    await remotePort.click();
    await expect(remotePort).toBeFocused();
    await page.screenshot({ path: '../../.codex-tmp/port-forwarding-workspace.png', animations: 'disabled' });
    await remotePort.press('Escape');
    await expect(forwardingPanel).toBeHidden();
    await page.getByRole('button', { name: 'Window layout', exact: true }).click();
    await checkRemoteWindowLayout(page);
    await checkThreadSidebarResize(page);
    const handle = page.getByRole('separator', { name: '调整聊天列表宽度' });
    await page.getByRole('button', { name: '收起聊天列表', exact: true }).click();
    await expect(handle).toHaveCount(0);
    await page.getByRole('button', { name: '打开聊天列表', exact: true }).click();
    await expect(handle).toHaveAttribute('aria-valuenow', '520');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '打开聊天列表', exact: true }).click();
    await expect(page.locator('.chat-drawer:visible .gui-remote-sidebar')).toBeVisible();
    await expect(handle).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(handle).toHaveAttribute('aria-valuenow', '520');
    await page.screenshot({ path: '../../.codex-tmp/remote-chat-sidebar-resize.png' });
  });

async function accountSummaryRows(page: Page) {
  return page.getByRole('button', { name: /^切换 GUI 账户：/ }).evaluate(button => {
    const body = button.querySelector(':scope > span')!;
    const summary = body.querySelector(':scope > span')!;
    const rows = [...summary.children];
    const top = body.getBoundingClientRect().top;
    return rows.map(row => {
      const bounds = row.getBoundingClientRect();
      return { top: bounds.top - top, height: bounds.height };
    });
  });
}

for (const blocked of [false, true]) {
  test(`prefetches remote history through collapsed pages over ${blocked ? 'Relay' : 'P2P'}`, async ({ context, page }) => {
    await checkRemoteHistory({ context, page, endpoint, blocked });
  });
  test(`corrects remote conversation timing over ${blocked ? 'Relay' : 'P2P'}`, async ({ context, page }) => {
    await checkRemoteTiming({ context, page, endpoint, blocked });
  });
  test(`@ references the selected computer over ${blocked ? 'Relay' : 'P2P'}`, async ({ context, page }) => {
    test.setTimeout(90_000);
    const office = await context.newPage();
    const home = await context.newPage();
    for (const [host, device, title] of [[office, 'computer-one', 'Office reference'],
      [home, 'computer-two', 'Home reference']] as const) {
      await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=${device}&blocked=${blocked}`
        + `&title=${encodeURIComponent(title)}&socket=${encodeURIComponent(endpoint)}`);
      await expect(host.locator('#status')).toHaveText('registered');
    }
    await page.bringToFront();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
    await chooseHost(page, 'Office PC');
    await expect(page.locator('.gui-remote-workspace:visible .chat-connection-status'))
      .toContainText(blocked ? 'Relay' : 'P2P', { timeout: 20_000 });
    const input = page.getByRole('textbox', { name: '聊天消息' });
    const menu = page.getByRole('menu', { name: '对话', exact: true });
    await expect(input).not.toHaveAttribute('placeholder', '连接后发消息');
    await input.fill('@');
    await expect(menu.getByRole('menuitem')).toHaveCount(1);
    await expect(menu).toContainText('Office reference');
    await expect(menu).not.toContainText('Home reference');
    await input.press('Enter');
    await expect(page.getByText('@Office reference', { exact: true })).toBeVisible();
    expect(await office.evaluate(() => window.chatTest.demoState().operations
      .filter(operation => operation.operation === 'send'))).toHaveLength(0);
    await input.fill('参考远程对话继续');
    await input.press('Enter');
    await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
      .find(operation => operation.operation === 'send'))).toMatchObject({ text: '参考远程对话继续',
      attachments: [{ kind: 'conversation', name: 'Office reference',
        path: 'codex-thread://demo-chat-computer-one' }] });
    await chooseComputer(page, 'Home PC');
    await expect(page.locator('.gui-remote-workspace:visible .chat-connection-status'))
      .toContainText(blocked ? 'Relay' : 'P2P', { timeout: 20_000 });
    await expect(input).not.toHaveAttribute('placeholder', '连接后发消息');
    await input.fill('@');
    await expect(menu.getByRole('menuitem')).toHaveCount(1);
    await expect(menu).toContainText('Home reference');
    await expect(menu).not.toContainText('Office reference');
    await page.screenshot({ path: `../../.codex-tmp/remote-conversation-${blocked ? 'relay' : 'p2p'}.png` });
    expect((await page.locator('.chat-composer-popover:visible').boundingBox())!.width).toBeLessThanOrEqual(400);
    const beats = await page.evaluate(() => window.remoteGuiFixture.beats());
    await expect.poll(() => page.evaluate(() => window.remoteGuiFixture.beats())).toBeGreaterThan(beats + 5);
    expect(await page.evaluate(() => window.remoteGuiFixture.commands.includes('codex_gui_request'))).toBe(false);
  });
}

for (const blocked of [false, true]) {
  test(`remote desktop tools use the selected computer over ${blocked ? 'Relay' : 'P2P'}`, async ({ context, page }) => {
    test.setTimeout(90_000);
    const office = await context.newPage();
    await office.goto(`/e2e/chat-harness.html?role=desktop&demo&remote-desktop&device=computer-one&title=Office`
      + `&blocked=${blocked}&socket=${encodeURIComponent(endpoint)}`);
    await expect(office.locator('#status')).toHaveText('registered');
    await office.evaluate(() => {
      window.chatTest.demoState().threads[0].turns![0].diff =
        'diff --git a/remote.txt b/remote.txt\n--- a/remote.txt\n+++ b/remote.txt\n@@ -1 +1 @@\n-before\n+remote edit\n';
    });
    await page.bringToFront();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
    await expect(page.getByRole('button', { name: '打开 Git', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '打开工具箱', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `../../.codex-tmp/gui-local-git-${blocked ? 'relay' : 'p2p'}.png` });
    await expect(page.getByRole('button', { name: '选择项目文件夹：workspace', exact: true }))
      .toHaveAttribute('title', '/local/workspace');
    await page.getByRole('button', { name: '打开 Git', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Git', exact: true })).toBeVisible();
    await checkGitDiffReview(page, `gui-local-git-diff-${blocked ? 'relay' : 'p2p'}`);
    await page.getByRole('button', { name: '关闭详情抽屉', exact: true }).click();
    await chooseComputer(page, 'Office PC');
    await page.getByRole('button', { name: 'Office', exact: true }).click();
    await expect(page.locator('.chat-connection-status')).toContainText(blocked ? 'Relay' : 'P2P');
    const cliUpdate = page.getByRole('button', { name: '远程 Codex CLI 更新' });
    await expect(cliUpdate).toHaveText('');
    await cliUpdate.click();
    await expect(page.getByRole('heading', { name: 'Codex 0.155.0', exact: true })).toBeVisible();
    await cliUpdate.click();
    await expect(page.getByRole('button', { name: '打开工具箱', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `../../.codex-tmp/gui-remote-git-${blocked ? 'relay' : 'p2p'}.png` });
    await expect(page.getByRole('button', { name: '选择远程项目', exact: true }))
      .toHaveAttribute('title', 'F:/projects/demo');
    await page.locator('.gui-remote-project').getByRole('button', { name: '打开 Git', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Git', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '切换主机：Office PC', exact: true })).toBeVisible();
    await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
      .some(operation => operation.operation === 'guiGitChanges' && operation.cwd === 'F:/projects/demo'))).toBe(true);
    await checkGitDiffReview(page, `gui-remote-git-diff-${blocked ? 'relay' : 'p2p'}`);
    await page.getByRole('button', { name: '关闭详情抽屉', exact: true }).click();
    const launcher = page.getByRole('button', { name: '打开远程桌面', exact: true });
    await expect(launcher).toBeVisible();
    const bounds = (await launcher.boundingBox())!;
    const connection = (await page.locator('.chat-connection-info').boundingBox())!;
    expect(connection.y).toBeGreaterThan(bounds.y + bounds.height);
    await expect(page.locator('.chat-header .chat-connection-info')).toHaveCount(0);
    expect(bounds.y).toBeGreaterThanOrEqual((await page.locator('.chat-header').boundingBox())!.y);
    await launcher.click();
    const desktop = page.getByRole('dialog', { name: '远程桌面', exact: true });
    await expect(desktop).toBeVisible();
    await expect.poll(() => desktop.locator('video').evaluate(video => video.videoWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await desktop.getByRole('button', { name: '显示桌面', exact: true }).click();
    await expect.poll(() => office.evaluate(() => window.desktopTest.inputs.at(-1)))
      .toEqual({ kind: 'key', key: 'desktop' });
    await desktop.getByRole('button', { name: '最小化', exact: true }).click();
    const restore = page.getByRole('button', { name: '恢复远程桌面', exact: true });
    await expect(restore.getByRole('status', { name: '正在后台运行' })).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/gui-remote-desktop-pill-${blocked ? 'relay' : 'p2p'}.png` });
    await restore.click();
    await desktop.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(desktop).toHaveCount(0);
    await expect.poll(() => office.evaluate(() => window.desktopTest.closed)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '重新连接远程 Codex' }).click();
    await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
      .some(operation => operation.operation === 'guiReconnect'))).toBe(true);
    await page.getByRole('button', { name: '查看文件更改' }).click();
    const details = page.getByRole('dialog', { name: '文件更改详情' });
    await expect(details).toContainText('remote edit');
    await page.getByRole('button', { name: '关闭详情抽屉' }).click();
    const summary = page.getByRole('region', { name: '本轮修改', exact: true });
    await expect(summary).toContainText('已编辑 1 个文件');
    await expect(summary.locator('li')).toContainText('+1−1');
    await summary.getByRole('button', { name: '查看 remote.txt 的差异', exact: true }).click();
    await details.getByRole('button', { name: '并排', exact: true }).click();
    await expect(details.getByText('修改前', { exact: true })).toBeVisible();
    await expect(details).toContainText('remote edit');
    await expect(page.locator('.chat-diff-workspace')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `../../.codex-tmp/gui-remote-diff-${blocked ? 'relay' : 'p2p'}.png` });
    await page.getByRole('button', { name: '关闭详情抽屉' }).click();
    await page.getByRole('button', { name: '打开远程终端' }).click();
    await expect(page.getByRole('region', { name: '终端', exact: true })).toBeVisible();
    const terminal = page.locator('.xterm-helper-textarea');
    await terminal.fill('echo remote');
    await terminal.press('Enter');
    await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
      .filter(operation => operation.operation === 'guiTerminalWrite').map(operation => operation.data).join('')))
      .toContain('echo remote');
    await page.getByRole('button', { name: '远程 Codex CLI 更新' }).click();
    await page.getByRole('button', { name: '检查版本', exact: true }).click();
    await page.getByRole('button', { name: '更新到 0.156.0' }).click();
    await expect(page.getByText('正在下载 Codex…')).toBeVisible();
    const beats = await page.evaluate(() => window.remoteGuiFixture.beats());
    await page.getByRole('button', { name: '远程 Codex CLI 更新' }).click();
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Draft while remote tools are active');
    await expect.poll(() => page.evaluate(() => window.remoteGuiFixture.beats())).toBeGreaterThan(beats + 5);
    await cliUpdate.click();
    await expect(page.getByRole('heading', { name: 'Codex 0.156.0', exact: true })).toBeVisible();
    await expect(cliUpdate).toHaveText('');
    await cliUpdate.click();
    await page.screenshot({ path: `../../.codex-tmp/gui-remote-tools-${blocked ? 'relay' : 'p2p'}.png` });
    await page.getByRole('button', { name: '关闭终端 1', exact: true }).click();
    await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
      .some(operation => operation.operation === 'guiTerminalClose'))).toBe(true);
    await chooseComputer(page, '本机');
    expect(await page.evaluate(() => window.remoteGuiFixture.commands
      .filter(command => /codex_gui_(cli_|terminal_|connect$|file_|git_tool)/.test(command)))).toEqual([]);
  });
}

for (const blocked of [false, true]) {
test(`keeps remote connections across device switches over ${blocked ? 'Relay' : 'P2P'}`, async ({ context, page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const office = await context.newPage();
  const home = await context.newPage();
  for (const [host, device, title] of [[office, 'computer-one', 'Office conversation'],
    [home, 'computer-two', 'Home conversation']] as const) {
    await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=${device}&blocked=${blocked}`
      + `&title=${encodeURIComponent(title)}&socket=${encodeURIComponent(endpoint)}`);
    await expect(host.locator('#status')).toHaveText('registered');
  }
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  const localRows = await accountSummaryRows(page);
  await chooseHost(page, 'Office PC');
  await expect(page.getByRole('button', { name: 'Office conversation', exact: true })).toBeVisible({ timeout: 20_000 });
  const quota = page.getByRole('progressbar', { name: '主用量剩余', exact: true });
  await expect(quota).toHaveAttribute('aria-valuenow', '28');
  await expect(quota).toBeVisible();
  await expect(page.getByRole('button', { name: /^切换 GUI 账户：/ })).toContainText('pro');
  expect(await accountSummaryRows(page)).toEqual(localRows);
  await page.getByRole('button', { name: 'Office conversation', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '聊天消息', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Continue slow task on the office computer');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
    .some(operation => operation.operation === 'send'))).toBe(true);
  const processing = page.locator('.gui-remote-workspace:visible .chat-message-content > .chat-processing-status');
  await expect(processing).toContainText(/共计.*秒/);
  await expect(processing).toBeInViewport();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Unsent office draft');
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: /演示账户二/ }).click();
  await expect(page.getByRole('button', { name: '切换 GUI 账户：演示账户二', exact: true })).toBeVisible();
  await expect(quota).toHaveAttribute('aria-valuenow', '83');
  expect(await home.evaluate(() => window.chatTest.demoState().operations
    .some(operation => operation.operation === 'guiAccountSelect'))).toBe(false);
  await chooseHost(page, 'Home PC');
  await expect(page.getByRole('button', { name: 'Home conversation', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Office conversation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '切换 GUI 账户：演示账户一', exact: true })).toBeVisible();
  await expect(quota).toHaveAttribute('aria-valuenow', '28');
  expect(await office.evaluate(() => window.chatTest.demoState().threads
    .some(thread => thread.turns?.some(turn => turn.status === 'inProgress')))).toBe(true);
  expect(await office.evaluate(() => window.chatTest.demoState().operations
    .some(operation => operation.operation === 'interrupt'))).toBe(false);
  const officeProcessing = page.locator('[aria-label="Codex GUI：Office PC"] .chat-processing-status');
  await expect(officeProcessing).toHaveCount(1);
  await office.evaluate(() => window.chatTest.setSidebar('complete'));
  await expect(officeProcessing).toHaveCount(0);
  await page.getByRole('button', { name: 'Home conversation', exact: true }).click();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Unsent home draft');
  await page.screenshot({ path: '../../.codex-tmp/gui-remote-home.png' });
  await chooseHost(page, '本地');
  await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveValue('Local unsent draft');
  for (const [name, title, draft] of [['Office PC', 'Office conversation', 'Unsent office draft'],
    ['Home PC', 'Home conversation', 'Unsent home draft'], ['Office PC', 'Office conversation', 'Unsent office draft']]) {
    await chooseHost(page, name);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '聊天消息', exact: true })).toHaveValue(draft);
    await expect(page.locator('.gui-remote-workspace:visible .chat-connection-status'))
      .toContainText(blocked ? 'Relay' : 'P2P');
  }
  const lifecycle = await page.evaluate(() => window.remoteGuiFixture.commands
    .filter(command => command === 'gui_remote_open' || command === 'gui_remote_close'));
  expect(lifecycle).toEqual(['gui_remote_open', 'gui_remote_open']);
  expect(await office.evaluate(() => window.chatTest.demoState().streamErrors)).toEqual([]);
  expect(errors).toEqual([]);
});
}

test('searches hosts beside the project picker and stays usable during slow discovery and a failed connection',
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
    const trigger = page.getByRole('button', { name: '切换主机：本地', exact: true });
    await trigger.click();
    const menu = page.getByRole('menu', { name: '主机列表' });
    await expect(menu.getByRole('menuitemradio', { name: '本地', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByRole('menuitemradio', { name: /Offline PC/ })).toBeDisabled();
    await page.screenshot({ path: '../../.codex-tmp/gui-host-picker-desktop.png' });
    const search = page.getByRole('textbox', { name: '搜索主机', exact: true });
    await search.fill('missing');
    await expect(page.getByText('没有找到匹配的主机')).toBeVisible();
    await search.fill('office');
    await expect(menu.getByRole('menuitemradio')).toHaveCount(1);
    await search.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: /Office PC/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(search).toHaveValue('');
    await page.evaluate(() => window.remoteGuiFixture.pauseDirectory());
    await page.getByRole('button', { name: '刷新主机列表', exact: true }).click();
    await expect(page.getByRole('button', { name: '刷新主机列表', exact: true })).toBeDisabled();
    const beats = await page.evaluate(() => window.remoteGuiFixture.beats());
    await search.fill('home');
    await expect(menu.getByRole('menuitemradio')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.remoteGuiFixture.beats())).toBeGreaterThan(beats + 4);
    await page.evaluate(() => window.remoteGuiFixture.releaseDirectory());
    await search.fill('office');
    await search.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Codex GUI：Office PC' })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '切换主机：Office PC', exact: true }).click();
    await expect(menu.getByRole('menuitemradio', { name: /Office PC/ })).toHaveAttribute('aria-checked', 'true');
    const bounds = (await page.locator('.ant-popover:visible').boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(400);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: '../../.codex-tmp/gui-host-picker-narrow.png' });
    await menu.getByRole('menuitemradio', { name: '本地', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveValue('Local unsent draft');
    await page.getByRole('button', { name: '更多项目选项', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择项目文件夹：workspace', exact: true })).toBeVisible();
  });

test('matches local GUI layout and sends pasted images and dropped files over Relay', async ({ context, page }) => {
  test.setTimeout(90_000);
  // The fixture opts into the shared skin; the GUI now defaults to its own skin selection.
  await context.addInitScript(() => localStorage.setItem('codex-switch:gui-skin', JSON.stringify({ mode: 'inherit' })));
  const office = await context.newPage();
  await office.goto(`/e2e/chat-harness.html?role=desktop&demo&blocked=true&device=computer-one`
    + `&title=Office&socket=${encodeURIComponent(endpoint)}`);
  await expect(office.locator('#status')).toHaveText('registered');
  // The simulated host opens a second tab; keep the tested UI visible so menu animations can finish.
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await chooseComputer(page, 'Office PC');
  await page.getByRole('button', { name: 'Office', exact: true }).click();
  await expect(page.locator('.chat-connection-status')).toContainText('Relay');
  await expect(page.locator('.gui-remote-workspace')).toHaveAttribute('data-dream-skin', 'true');
  await expect(page.getByRole('button', { name: '新对话', exact: true })).toBeVisible();
  await expect(page.getByText('最近', { exact: true })).toBeVisible();
  await expect(page.getByText('已归档', { exact: true })).toBeVisible();
  expect((await page.locator('.chat-sidebar').boundingBox())!.width).toBe(236);
  expect((await page.locator('.chat-header').boundingBox())!.height).toBe(38);
  await expect(page.locator('.chat-conversation')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.evaluate(() => {
    window.remoteGuiFixture.setFontSize(16);
    window.remoteGuiFixture.setThemeMode('dark');
    window.dispatchEvent(new CustomEvent('codex-switch:dream-skin-status-changed', { detail: {
      installed: true, session: 'running', activeThemeId: 'fixture', activeThemeAppearance: 'dark',
      activeThemeOverlayOpacity: 0.85,
    } }));
  });
  await expect(page.locator('.chat-message-region')).toHaveCSS('color', 'rgb(230, 232, 235)');
  await expect(page.getByText('可以，今天先完成这三件事：', { exact: true })).toHaveCSS('font-size', '16px');
  await page.getByRole('button', { name: '访问权限：帮我批准', exact: true }).click();
  await expect(page.locator('.chat-composer-access-menu')).toBeVisible();
  await expect(page.locator('.ant-popover:visible')).toHaveCSS('opacity', '1');
  await expect(page.locator('.chat-composer-access-menu')).toHaveCSS('color', 'rgb(230, 232, 235)');
  await page.screenshot({ path: '../../.codex-tmp/gui-remote-dark.png' });
  await page.getByRole('button', { name: '访问权限：帮我批准', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex-switch:dream-skin-status-changed', {
    detail: { installed: true, session: 'running', activeThemeId: 'fixture', activeThemeAppearance: 'light',
      activeThemeOverlayOpacity: 0.85 },
  })));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 240;
    const drawing = canvas.getContext('2d')!; drawing.fillStyle = '#35ada7'; drawing.fillRect(0, 0, 600, 240);
    const data = canvas.toDataURL('image/png').split(',')[1];
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([Uint8Array.from(atob(data), byte => byte.charCodeAt(0))],
      'screenshot.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  const preview = page.getByRole('img', { name: '待发送图片 1', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  expect(await preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: '../../.codex-tmp/gui-remote-paste-theme.png' });
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
    .filter(operation => operation.operation === 'send').map(operation => operation.images))).toEqual([
    [expect.stringMatching(/^data:image\/jpeg;base64,/)]]);
  await expect(preview).toHaveCount(0);
  await checkRemoteFileDrop(page, office);
  expect(await page.evaluate(() => window.remoteGuiFixture.commands
    .filter(command => /codex_gui_(connect|disconnect|request|respond)$/.test(command)))).toEqual([]);
});

test('keeps input responsive during native image reads and discards reads from a previous computer', async ({ context, page }) => {
  for (const device of ['computer-one', 'computer-two']) {
    const host = await context.newPage();
    await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=${device}&socket=${encodeURIComponent(endpoint)}`);
    await expect(host.locator('#status')).toHaveText('registered');
  }
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await chooseComputer(page, 'Office PC');
  await page.getByRole('button', { name: 'computer-one', exact: true }).click();
  await page.evaluate(() => { window.remoteGuiFixture.copyImage(); window.remoteGuiFixture.pauseClipboard(); });
  const beats = await page.evaluate(() => window.remoteGuiFixture.beats());
  const input = page.getByRole('textbox', { name: '聊天消息', exact: true });
  await input.dispatchEvent('keydown', { key: 'v', ctrlKey: true });
  await expect(page.getByText('正在添加附件…', { exact: true })).toBeVisible();
  await input.fill('draft while reading');
  await expect(input).toHaveValue('draft while reading');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.remoteGuiFixture.beats())).toBeGreaterThan(beats + 4);
  await chooseComputer(page, 'Home PC');
  await page.getByRole('button', { name: 'computer-two', exact: true }).click();
  await page.evaluate(() => window.remoteGuiFixture.releaseClipboard());
  await expect(page.getByRole('img', { name: '待发送图片 1', exact: true })).toHaveCount(0);
  await input.dispatchEvent('keydown', { key: 'v', ctrlKey: true });
  await expect(page.getByRole('img', { name: '待发送图片 1', exact: true })).toBeVisible();
  await chooseComputer(page, '本机');
  await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveValue('Local unsent draft');
});

test('keeps the account panel and device dropdown compact and responsive during slow discovery and a failed connection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  const before = await page.evaluate(() => window.remoteGuiFixture.beats());
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  await expect(page.getByRole('button', { name: /Offline PC/ })).toBeDisabled();
  await page.evaluate(() => window.remoteGuiFixture.pauseDirectory());
  await page.getByRole('button', { name: '刷新设备列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新设备列表', exact: true })).toBeDisabled();
  await page.screenshot({ path: '../../.codex-tmp/gui-computer-menu-narrow.png' });
  await page.getByRole('button', { name: '切换设备', exact: true }).press('Escape');
  await expect(page.getByRole('region', { name: '设备列表' })).toBeHidden();
  const search = page.getByRole('textbox', { name: '搜索账号或 Provider', exact: true });
  await search.fill('alex'); await search.press('ArrowLeft');
  await expect(search).toBeVisible(); await expect(search).toHaveValue('alex');
  await expect.poll(() => page.evaluate(() => window.remoteGuiFixture.beats())).toBeGreaterThan(before + 4);
  const bounds = (await page.locator('.ant-popover:visible').boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(400);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '../../.codex-tmp/gui-account-submenu-narrow.png' });
  await page.evaluate(() => window.remoteGuiFixture.releaseDirectory());
  await search.press('Escape');
  await chooseComputer(page, 'Office PC');
  await expect(page.getByRole('region', { name: 'Codex GUI：Office PC' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('电脑的聊天连接尚未就绪');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })
    .and(page.locator(':enabled'))).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveCount(0);
  await page.getByRole('button', { name: '打开聊天列表', exact: true }).click();
  await chooseComputer(page, '本机');
  await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveValue('Local unsent draft');
});
