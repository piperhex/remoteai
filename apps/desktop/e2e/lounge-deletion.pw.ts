import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { deletionDevice, enterDeletionLounge, assertEmptyReopened, deletionTime } from './lounge-deletion-support';

const { LoungeSyncBroker } = createRequire(import.meta.url)('../../../shared/lounge/testing/syncBroker') as
  typeof import('../../../shared/lounge/testing/syncBroker');
test.setTimeout(90_000);

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: compact people menu, confirmation, deletion and fresh history at both font settings`, async ({ page }) => {
    const relay = await deletionDevice(page, mode);
    relay.private('private history before deletion');
    const person = page.locator('.lounge-people-list').getByRole('button', { name: '与 bob 私聊', exact: true });
    await expect(person).toBeVisible();
    for (const size of [14, 20]) {
      await page.evaluate(size => {
        localStorage.setItem('codex-switch:global-font-size', String(size));
        window.dispatchEvent(new Event('codex-switch:gui-appearance-changed'));
      }, size);
      if (size === 20) await page.setViewportSize({ width: 1050, height: 800 });
      await person.click({ button: 'right' });
      const items = page.getByRole('menuitem');
      const listSize = await person.locator('.lounge-person-copy > span').evaluate(node => getComputedStyle(node).fontSize);
      await expect(items.first()).toHaveCSS('font-size', listSize);
      await expect(items.last()).toHaveText('删除');
      await items.last().hover();
      await expect(page.locator('.adm-toast-main')).toHaveCount(0);
      await page.screenshot({ path: `../../.codex-tmp/lounge-delete-menu-${mode}-${size}.png`, animations: 'disabled' });
      await items.last().click();
      const dialog = page.getByRole('dialog', { name: '删除这段私聊？', exact: true });
      await expect(dialog).toContainText('你所有设备');
      await expect(dialog).toContainText('对方的记录会保留');
      expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(400);
      await dialog.getByRole('button', { name: '取消', exact: true }).hover();
      await expect(page.locator('.adm-toast-main')).toHaveCount(0);
      await page.screenshot({ path: `../../.codex-tmp/lounge-delete-confirm-${mode}-${size}.png`, animations: 'disabled' });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(person).toBeVisible();
    }
    await person.click({ button: 'right' }); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
    await expect(person).toHaveCount(0);
    await page.reload(); await enterDeletionLounge(page, mode);
    await expect(person).toHaveCount(0);
    await assertEmptyReopened(page, mode, relay);
    relay.private('new private history');
    await expect(page.locator('.lounge-text')).toHaveText('new private history');
    await page.screenshot({ path: `../../.codex-tmp/lounge-delete-fresh-${mode}.png`, animations: 'disabled' });
  });
}

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: same-account device deletion sync and stale offline records stay deleted`, async ({ page, browser }) => {
    const broker = new LoungeSyncBroker();
    const source = await deletionDevice(page, 'local', broker);
    source.private('old synced private history');
    const context = await browser.newContext();
    try {
      const other = await context.newPage(); const sink = await deletionDevice(other, mode, broker);
      const person = other.locator('.lounge-person, .lounge-chat-row-main')
        .and(other.getByRole('button', { name: '与 bob 私聊', exact: true })).filter({ visible: true });
      await expect(person).toBeVisible({ timeout: 30_000 });
      // Keep a peer offline while deleting, then reconnect it to exercise durable tombstone catch-up.
      broker.fail = true; broker.disconnectAll();
      const row = page.locator('.lounge-people-list').getByRole('button', { name: '与 bob 私聊', exact: true });
      await row.click({ button: 'right' }); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
      await expect(row).toHaveCount(0);
      broker.fail = false;
      await other.reload(); await enterDeletionLounge(other, mode);
      await expect.poll(() => deletionTime(other), { timeout: 30_000 }).toBeGreaterThan(0);
      await expect(person).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByRole('button', { name: '与 bob 私聊', exact: true })).toHaveCount(0);
      await assertEmptyReopened(other, mode, sink);
      sink.frame({ type: 'message', id: 'late-old', text: 'late old private history', images: [],
        sender: { id: 'bob', account: 'bob@example.test' }, recipient: { id: 'alice', account: 'alice@example.test' },
        sentAt: '2026-01-01T00:00:00.000Z', receipts: true });
      await expect(other.locator('.lounge-message')).toHaveCount(0);
      sink.private('new conversation after deletion');
      await expect(other.locator('.lounge-text')).toHaveText('new conversation after deletion');
      await expect(other.locator('.adm-toast-main')).toHaveCount(0);
      await expect(other.locator('.lounge-sync-notice')).toHaveCount(0);
      await other.screenshot({ path: `../../.codex-tmp/lounge-delete-sync-${mode}.png`, animations: 'disabled' });
      await other.reload(); await enterDeletionLounge(other, mode);
      await person.click();
      await expect(other.locator('.lounge-text')).toHaveText('new conversation after deletion');
    } finally { await context.close(); broker.disconnectAll(); }
  });
}

for (const mode of ['remote', 'mobile']) {
  test(`${mode}: a live deletion clears open private history and its draft on another device`, async ({ page, browser }) => {
    const broker = new LoungeSyncBroker();
    const source = await deletionDevice(page, 'local', broker);
    source.private('old live private history');
    const context = await browser.newContext();
    try {
      const other = await context.newPage(); const sink = await deletionDevice(other, mode, broker);
      const person = other.locator('.lounge-person, .lounge-chat-row-main')
        .and(other.getByRole('button', { name: '与 bob 私聊', exact: true })).filter({ visible: true });
      await expect(person).toBeVisible({ timeout: 30_000 }); await person.click();
      await expect(other.locator('.lounge-text')).toHaveText('old live private history');
      await other.getByRole('textbox', { name: '消息', exact: true }).fill('private draft before deletion');
      if (mode === 'mobile') await other.getByRole('button', { name: '添加内容', exact: true }).click();
      await other.getByRole('button', { name: '历史记录', exact: true }).click();
      const history = other.getByRole('dialog', { name: '历史记录', exact: true });
      await expect(history).toContainText('old live private history');
      await page.locator('.lounge-people-list').getByRole('button', { name: '与 bob 私聊', exact: true })
        .click({ button: 'right' });
      await page.getByRole('menuitem', { name: '删除', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
      await expect.poll(() => deletionTime(other), { timeout: 30_000 }).toBeGreaterThan(0);
      await expect(history).toBeHidden(); await expect(person).toHaveCount(0);
      await expect(other.getByText('old live private history', { exact: true })).toHaveCount(0);
      await assertEmptyReopened(other, mode, sink);
      await expect(other.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('');
    } finally { await context.close(); broker.disconnectAll(); }
  });
}
