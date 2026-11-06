import { expect, test, type Page } from '@playwright/test';
import { setupLounge } from './lounge-support';
import { foreground } from './lounge-group-read-support';

async function savedReceipt(page: Page, id: string) {
  return page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remoteai-lounge-history-v1');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ delivery?: { status: string; confirmed?: string; groupReceiptError?: string } }>(
        (resolve, reject) => {
          const request = database.transaction('content').objectStore('content').get([
            JSON.stringify(['https://lounge.test', 'alice@example.test']), JSON.stringify(['manager', id]),
          ]);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
    } finally { database.close(); }
  }, id);
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: invalid historical receipt stops durably and valid reads still retry`, async ({ page }) => {
    const web = mode === 'web';
    const relay = await setupLounge(page, web);
    const ready = () => relay.frame({ type: 'ready', groupReads: true, direct: true, receipts: true,
      user: { id: 'alice', account: 'alice@example.test' }, policy: { moderator: false, mutedUntil: null } });
    await page.goto(web ? process.env.LOUNGE_RECEIPT_WEB_URL ?? 'http://127.0.0.1:1486/web/'
      : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready(); ready();
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    await foreground(page, true);
    const push = (id: string, text: string) => relay.frame({ type: 'message', id, text, images: [],
      sender: { id: 'manager', account: 'manager', moderator: true }, groupReceipt: `signed-${id}`,
      sentAt: new Date().toISOString() });
    const reads = (id: string) => relay.groupReadFrames.filter(frame => frame.type === 'group-read' && frame.id === id);
    push('historical', '历史群通知');
    await expect.poll(() => reads('historical').length).toBe(1);
    relay.frame({ type: 'group-receipt-rejected', code: 'invalid-group-receipt', receiptType: 'group-read',
      id: 'historical', from: 'manager', to: 'alice', groupReceipt: 'signed-historical' });
    await expect.poll(async () => (await savedReceipt(page, 'historical'))?.delivery?.groupReceiptError)
      .toBe('invalid-group-receipt');
    expect((await savedReceipt(page, 'historical')).delivery?.confirmed).toBe('delivered');
    // Observe a complete retry interval using real browser timers, including visibility observers.
    await page.waitForTimeout(6000);
    expect(reads('historical')).toHaveLength(1);
    const connections = relay.count(); const authentications = relay.reportedVersions.length;
    relay.close();
    await expect.poll(relay.count).toBeGreaterThan(connections);
    await expect.poll(() => relay.reportedVersions.length).toBeGreaterThan(authentications); ready();
    expect(reads('historical')).toHaveLength(1);
    const beforeReload = relay.reportedVersions.length; await page.reload();
    await expect.poll(() => relay.reportedVersions.length).toBeGreaterThan(beforeReload); ready();
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    await foreground(page, true);
    await expect(page.getByText('历史群通知', { exact: true })).toBeVisible();
    push('valid', '新群通知仍可正常已读');
    await expect(page.getByText('新群通知仍可正常已读', { exact: true })).toBeVisible();
    await expect.poll(() => reads('valid').length).toBe(1);
    await page.waitForTimeout(6000);
    await expect.poll(() => reads('valid').length).toBeGreaterThan(1);
    relay.frame({ type: 'group-read-confirm', id: 'valid', from: 'manager', to: 'alice', groupReceipt: 'signed-valid' });
    await expect.poll(async () => (await savedReceipt(page, 'valid'))?.delivery?.confirmed).toBe('read');
    const validCount = reads('valid').length;
    await page.waitForTimeout(6000);
    expect(reads('valid')).toHaveLength(validCount); expect(reads('historical')).toHaveLength(1);
    await expect(page.locator('.lounge-page')).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/lounge-receipt-${mode}-connected.png`, animations: 'disabled' });
  });
}
