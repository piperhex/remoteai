import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import type { LoungeSyncBroker as Broker } from '../../../shared/lounge/testing/syncBroker';
import { pixel, setupLounge } from './lounge-support';

const webURL = process.env.LOUNGE_TEST_WEB_URL ?? 'http://127.0.0.1:1486/web/';
const { LoungeSyncBroker } = createRequire(import.meta.url)('../../../shared/lounge/testing/syncBroker') as
  typeof import('../../../shared/lounge/testing/syncBroker');
test.setTimeout(120_000);

async function openGroup(page: Page, mode: string) {
  if (mode !== 'mobile') {
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    return;
  }
  await page.getByRole('tab', { name: '发现', exact: true }).click();
  await page.locator('.discovery-lounge').click();
  await page.getByRole('button', { name: '群聊', exact: true }).click();
}

async function connect(page: Page, broker: Broker, mode: string, direct: boolean) {
  const web = mode === 'web' || mode === 'mobile';
  const lounge = await setupLounge(page, web);
  // The desktop fixture runs in Chromium, which supplies the data channel in place of native RTC IPC.
  if (direct && !web) await page.route('**/src/nativeRtc/connection.ts*', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'export const createNativeRtcConnection = configuration => new RTCPeerConnection(configuration);',
  }));
  lounge.enableDeviceSync();
  let offlineAttempts = 0;
  await page.routeWebSocket('**/device-chat', route => {
    if (broker.fail) offlineAttempts++;
    const client = broker.attach({ send: data => route.send(typeof data === 'string' ? data : Buffer.from(data)),
      close: () => route.close({ code: 1001 }) });
    route.onMessage(client.receive); route.onClose(client.disconnect);
  });
  await page.addInitScript(direct => {
    if (!direct) {
      Object.defineProperty(window, 'RTCPeerConnection', { value: class { constructor() { throw new Error('No ICE'); } } });
      return;
    }
    const send = RTCDataChannel.prototype.send;
    Object.assign(window, { historyDirectFrames: 0 });
    RTCDataChannel.prototype.send = function (data: string) {
      (window as unknown as { historyDirectFrames: number }).historyDirectFrames++;
      return send.call(this, data as never);
    };
  }, direct);
  if (mode === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(web ? webURL : `/e2e/lounge-harness.html?mode=${mode}`);
  await lounge.ready();
  await openGroup(page, mode);
  return { ...lounge, offlineAttempts: () => offlineAttempts };
}

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: encrypted device sync restores pages, images, replies and catches up after reconnect`, async ({ page,
    browser }) => {
    const broker = new LoungeSyncBroker(); const direct = mode === 'remote' || mode === 'mobile';
    const source = await connect(page, broker, 'local', direct);
    for (let index = 0; index < 60; index++) source.push(`历史消息 ${String(index).padStart(2, '0')}`);
    const quote = source.push('图片原文', [pixel]); source.push('带引用的历史消息', [], quote);
    await expect(page.locator('.lounge-message')).toHaveCount(62);
    const context = await browser.newContext();
    try {
      const other = await context.newPage(); const sink = await connect(other, broker, mode, direct);
      await expect(other.locator('.lounge-message')).toHaveCount(62, { timeout: 30_000 });
      await expect(other.locator('.lounge-avatar-unread')).toHaveCount(0);
      await expect(other.locator('.lounge-text').filter({ hasText: '带引用的历史消息' })).toBeVisible();
      expect(broker.relayFrames).toBeGreaterThan(0);
      if (direct) {
        await expect.poll(() => other.evaluate(() => (window as unknown as { historyDirectFrames: number })
          .historyDirectFrames)).toBeGreaterThan(10);
        expect(broker.signalFrames).toBeGreaterThan(0);
      }
      broker.fail = true; broker.disconnectAll();
      await expect.poll(sink.offlineAttempts).toBeGreaterThan(0);
      await expect(other.getByRole('textbox', { name: '消息', exact: true })).toBeEditable();
      await expect(other.getByText('设备间消息同步暂时中断，正在重试。', { exact: true })).toHaveCount(0);
      await expect(other.getByRole('button', { name: '重试', exact: true })).toHaveCount(0);
      await other.screenshot({ path: `../../.codex-tmp/lounge-device-sync-${mode}-offline.png`, animations: 'disabled' });
      source.push('断线期间补回的消息');
      broker.fail = false;
      await expect(other.locator('.lounge-message')).toHaveCount(63, { timeout: 30_000 });
      await expect(other.getByRole('alert')).toHaveCount(0);
      await other.screenshot({ path: `../../.codex-tmp/lounge-device-sync-${mode}.png`, animations: 'disabled' });
      expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await other.reload();
      await expect.poll(() => broker.clients.size).toBe(2);
      await openGroup(other, mode);
      await expect(other.locator('.lounge-message')).toHaveCount(63);
    } finally { await context.close(); broker.disconnectAll(); }
  });
}

test('private history excludes deleted generations and never replays the sender’s outbox', async ({ page, browser }) => {
  const broker = new LoungeSyncBroker(); const source = await connect(page, broker, 'local', false);
  source.private('已删除的旧消息'); broker.generations.set('bob', 1);
  source.frame({ type: 'message', id: 'new-generation', sender: { id: 'bob', account: 'bob@example.test' },
    recipient: { id: 'alice', account: 'alice@example.test' }, text: '删除后的新消息', images: [pixel],
    sentAt: new Date().toISOString(), generation: 1, receipts: true });
  const context = await browser.newContext();
  try {
    const other = await context.newPage(); const sink = await connect(other, broker, 'remote', false);
    await other.getByRole('button', { name: '与 bob 私聊', exact: true }).click();
    await expect(other.locator('.lounge-text')).toHaveText('删除后的新消息');
    expect(sink.sent).toHaveLength(0);
    await expect(other.locator('.lounge-avatar-unread')).toHaveCount(0);
  } finally { await context.close(); broker.disconnectAll(); }
});

test('device sync interruptions stay silent across language changes', async ({ page }) => {
  const broker = new LoungeSyncBroker(); broker.fail = true;
  const sink = await connect(page, broker, 'local', false);
  await expect.poll(sink.offlineAttempts).toBeGreaterThan(1);
  for (const [language, text] of [['zh', '设备间消息同步暂时中断'], ['en', 'Message sync between devices'],
    ['ja', '端末間のメッセージ同期'], ['ru', 'Синхронизация сообщений между устройствами']] as const) {
    await page.evaluate(language => window.loungeFixture.setLanguage(language), language);
    await expect(page.getByText(text)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});
