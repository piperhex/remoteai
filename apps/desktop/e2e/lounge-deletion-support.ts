import { expect, type Page } from '@playwright/test';
import type { LoungeSyncBroker } from '../../../shared/lounge/testing/syncBroker';
import { setupLounge } from './lounge-support';

export async function enterDeletionLounge(page: Page, mode: string) {
  if (mode !== 'mobile') return page.getByRole('button', { name: '在线交流', exact: true }).click();
  await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
  await page.locator('.discovery-lounge').click();
}

export async function deletionDevice(page: Page, mode: string, broker?: LoungeSyncBroker) {
  const web = mode === 'web' || mode === 'mobile';
  const relay = await setupLounge(page, web);
  if (broker) {
    relay.enableDeviceSync();
    await page.routeWebSocket('**/device-chat', route => {
      const client = broker.attach({ send: data => route.send(typeof data === 'string' ? data : Buffer.from(data)),
        close: () => route.close({ code: 1001 }) });
      route.onMessage(client.receive); route.onClose(client.disconnect);
    });
    await page.addInitScript(() => {
      Object.defineProperty(window, 'RTCPeerConnection', { value: class { constructor() { throw new Error('No ICE'); } } });
    });
  }
  await page.setViewportSize({ width: mode === 'mobile' ? 390 : 1440, height: 900 });
  await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
  await relay.ready(); await enterDeletionLounge(page, mode);
  return relay;
}

export async function assertEmptyReopened(page: Page, mode: string, relay: Awaited<ReturnType<typeof setupLounge>>) {
  if (mode === 'mobile') await page.getByRole('button', { name: '群聊', exact: true }).click();
  relay.push('group profile source');
  await expect(page.locator('.lounge-message')).toContainText(['group profile source']);
  await page.locator('.lounge-bubble').filter({ hasText: 'group profile source' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '发起私聊', exact: true }).click();
  await expect(page.locator('.lounge-message')).toHaveCount(0);
}

export async function deletionTime(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('remoteai-lounge-history-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('deletions');
      const rows = transaction.objectStore('deletions').getAll();
      transaction.oncomplete = () => {
        db.close(); resolve(rows.result.find(row => row.peer === 'bob')?.deletedAt ?? 0);
      };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}
