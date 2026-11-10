import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test, expect, type Page } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { ChatSessionsFixture } from '../../../shared/testing/chatSessions.mjs';
import './chat-harness-types';
import type {} from './remote-gui-native-fixture';

let server: WebSocketServer;
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
      sessions.join(socket, { role: frame.role, deviceId: frame.deviceId, ownerId: 'owner',
        expiresAt: Date.now() + 300_000 }, frame, []);
    });
    socket.on('close', () => sessions.disconnect(socket));
  });
});

test.afterEach(async () => {
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function chooseHost(page: Page, name: string) {
  await page.getByRole('button', { name: /^切换主机：/ }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(name) }).click();
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await expect(page.getByRole('button', { name: '刷新账户列表', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Codex GUI 设置', exact: true }).click();
  await expect(page.getByRole('switch', { name: '自动切换账号', exact: true })).toBeVisible();
}

const dialog = (page: Page) => page.getByRole('dialog', { name: /Codex GUI 设置/ });
const closeSettings = (page: Page) => dialog(page).getByRole('button', { name: 'Close', exact: true }).click();

async function verifyBounds(page: Page) {
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).not.toHaveClass(/zoom-(appear|enter)/);
  const bounds = (await dialog(page).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await dialog(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
}

for (const scenario of [
  { width: 1440, font: 14, mode: 'light', blocked: false },
  { width: 960, font: 20, mode: 'dark', blocked: true },
] as const) {
  test(`remote settings persist on the selected computer at ${scenario.width}px ${scenario.font}px ${scenario.mode}`,
    async ({ context, page }, info) => {
      test.setTimeout(90_000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const hosts = await Promise.all(['computer-one', 'computer-two'].map(async device => {
        const host = await context.newPage();
        await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=${device}&blocked=${scenario.blocked}`
          + `&socket=${encodeURIComponent(endpoint)}`);
        await expect(host.locator('#status')).toHaveText('registered');
        return host;
      }));
      await page.setViewportSize({ width: scenario.width, height: 900 });
      await page.goto(`/e2e/remote-gui-harness.html?settings&font=${scenario.font}`
        + `${scenario.mode === 'dark' ? '&dark' : ''}&socket=${encodeURIComponent(endpoint)}`);
      await openSettings(page);
      const localTitleSize = await dialog(page).locator('.ant-modal-title').evaluate(node =>
        getComputedStyle(node).fontSize);
      const localNavigationSize = await dialog(page).getByRole('tab', { name: '界面', exact: true })
        .locator('span').first().evaluate(node => getComputedStyle(node).fontSize);
      await page.screenshot({ path: info.outputPath('desktop-local-settings-accounts.png'), animations: 'disabled' });
      await closeSettings(page);
      await chooseHost(page, 'Office PC');
      await expect(page.locator('.gui-remote-workspace:visible .chat-connection-status'))
        .toContainText(scenario.blocked ? 'Relay' : 'P2P', { timeout: 20_000 });
      const navigation = page.getByRole('navigation', { name: 'Codex GUI 导航' });
      await expect(navigation.getByRole('button')).toHaveText(['新对话', '对话同步']);
      await expect(page.locator('.chat-header').getByRole('button', { name: 'Codex GUI 设置' })).toHaveCount(0);
      await navigation.getByRole('button', { name: '对话同步' }).click();
      await expect(navigation.getByRole('button', { name: '对话同步' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('region', { name: '对话同步', exact: true })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: '展开项目: F:/projects/remoteai', exact: true }).click();
      await expect(page.getByText('排查项目中的登录问题', { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath('desktop-remote-sync-page.png'), animations: 'disabled' });
      await navigation.getByRole('button', { name: '新对话' }).click();
      await expect(page.getByRole('region', { name: '对话同步', exact: true })).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: '聊天消息', exact: true })).toBeVisible();
      await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
      await page.getByRole('button', { name: 'Codex GUI 设置', exact: true }).click({ trial: true });
      await page.screenshot({ path: info.outputPath('desktop-remote-account-menu.png'), animations: 'disabled' });
      await page.getByRole('button', { name: 'Codex GUI 设置', exact: true }).click();
      await expect(page.getByRole('tab')).toHaveText(['自动切号', '上下文', '消息发送', '界面', '系统提示词']);
      await expect(dialog(page).locator('.ant-modal-title')).toHaveCSS('font-size', localTitleSize);
      await expect(dialog(page).getByRole('tab', { name: '界面', exact: true }).locator('span').first())
        .toHaveCSS('font-size', localNavigationSize);
      await verifyBounds(page);
      await page.screenshot({ path: info.outputPath('desktop-remote-settings-accounts.png'), animations: 'disabled' });
      await dialog(page).getByRole('table').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('desktop-remote-settings-account-table.png'),
        animations: 'disabled' });
      await dialog(page).getByRole('spinbutton', { name: '默认剩余额度阈值', exact: true }).fill('12');
      await dialog(page).getByRole('button', { name: /^保\s*存$/ }).click();
      await openSettings(page);
      await expect(dialog(page).getByRole('spinbutton', { name: '默认剩余额度阈值', exact: true })).toHaveValue('12.0');
      await dialog(page).getByRole('tab', { name: '上下文', exact: true }).click();
      const capacity = dialog(page).getByRole('combobox', { name: 'remote-model 上下文容量', exact: true });
      await capacity.fill('256'); await capacity.blur();
      await expect.poll(() => hosts[0].evaluate(() => window.chatTest.demoState().operations
        .some(op => op.operation === 'guiModelContextWrite' && op.capacity === 256_000))).toBe(true);
      await page.screenshot({ path: info.outputPath('desktop-remote-settings-context.png'), animations: 'disabled' });
      await dialog(page).getByRole('tab', { name: '消息发送', exact: true }).click();
      const queue = dialog(page).getByRole('switch');
      await expect(queue).toBeChecked(); await queue.click(); await expect(queue).not.toBeChecked();
      await page.screenshot({ path: info.outputPath('desktop-remote-settings-messages.png'), animations: 'disabled' });
      await dialog(page).getByRole('tab', { name: '界面', exact: true }).click();
      await dialog(page).getByRole('switch').click();
      const font = dialog(page).getByRole('spinbutton', { name: '字体大小', exact: true });
      await font.fill('18'); await font.blur();
      await expect(page.getByRole('textbox', { name: '聊天消息', exact: true })).toHaveCSS('font-size', '18px');
      await expect(dialog(page).locator('.ant-modal-title')).toHaveCSS('font-size', localTitleSize);
      await page.screenshot({ path: info.outputPath('desktop-remote-settings-appearance.png'),
        animations: 'disabled' });
      await dialog(page).getByRole('tab', { name: '系统提示词', exact: true }).click();
      await expect(dialog(page).getByText('远程工作规则', { exact: true })).toBeVisible();
      await dialog(page).getByRole('switch', { name: '启用或禁用系统提示词注入' }).click();
      await expect(dialog(page).getByRole('switch', { name: '启用或禁用系统提示词注入' })).toBeChecked();
      await page.screenshot({ path: info.outputPath('desktop-remote-settings-prompts.png'), animations: 'disabled' });
      await closeSettings(page);
      await openSettings(page);
      await dialog(page).getByRole('tab', { name: '上下文', exact: true }).click();
      await expect(capacity).toHaveValue('256');
      await dialog(page).getByRole('tab', { name: '系统提示词', exact: true }).click();
      await expect(dialog(page).getByRole('switch', { name: '启用或禁用系统提示词注入' })).toBeChecked();
      await closeSettings(page);
      await chooseHost(page, 'Home PC');
      await openSettings(page);
      await expect(dialog(page).getByRole('spinbutton', { name: '默认剩余额度阈值', exact: true })).toHaveValue('0.0');
      expect(await hosts[1].evaluate(() => window.chatTest.demoState().operations
        .some(op => String(op.operation).endsWith('Write')))).toBe(false);
      const localWrites = await page.evaluate(() => {
        const settingsWrite = /^codex_gui_set_(auto_switch_settings|model_context|system_prompt_settings)$/;
        return window.remoteGuiFixture.commands.filter(command => settingsWrite.test(command));
      });
      expect(localWrites).toEqual([]);
      expect(errors).toEqual([]);
    });
}
