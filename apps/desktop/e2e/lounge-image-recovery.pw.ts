import { test, expect, type Page } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';
import { AttachmentBroker } from './lounge-attachments-support';
import type { LoungeAttachment } from '../../../shared/lounge/attachments';

async function capture(page: Page, mode: string, state: string) {
  await expect(page.locator('.adm-toast-wrap:visible')).toHaveCount(0);
  await page.screenshot({ path: `../../.codex-tmp/lounge-recovery/${mode}-light-${state}.png` });
}

async function enter(page: Page, mode: string) {
  const mobile = mode === 'mobile';
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const web = mode === 'web' || mobile;
  const lounge = await setupLounge(page, web);
  await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
  await lounge.ready();
  lounge.frame({ type: 'ready', user: { id: 'alice', account: 'alice@example.test' }, attachments: true,
    direct: true, receipts: true, imageReceipts: true, blocked: [] });
  if (mobile) {
    await page.getByRole('tab', { name: '发现', exact: true }).click();
    await page.locator('.discovery-lounge').click();
  } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
  lounge.private('history-ready');
  await page.getByRole('button', { name: '与 bob 私聊', exact: true }).filter({ visible: true }).click();
  return lounge;
}

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: historical image retries from restarted sender and remains available offline`,
    async ({ page, context, browser }) => {
      const broker = new AttachmentBroker(); await broker.install(context);
      const sender = await enter(page, mode);
      sender.acknowledge(false);
      await page.locator('.lounge-composer input[accept]').setInputFiles({ name: 'history.png',
        mimeType: 'image/png', buffer: Buffer.from(pixel.split(',')[1], 'base64') });
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect.poll(() => sender.sent.length).toBe(1);
      const file = (sender.sent[0] as typeof sender.sent[0] & { attachments: LoungeAttachment[] }).attachments[0];
      sender.frame({ type: 'image-pending', from: 'bob', to: 'alice', id: sender.sent[0].id, status: 'delivered' });
      const status = page.locator('.lounge-message.is-own .lounge-delivery');
      await expect(status.getByRole('img', { name: '等待对方接收' })).toBeVisible();
      await expect(status.getByRole('img', { name: '对方已收到' })).toBeVisible();
      await capture(page, mode, 'image-pending');
      await page.close();

      const receivingContext = await browser.newContext();
      try {
        await broker.install(receivingContext);
        const receiving = await receivingContext.newPage();
        const target = await enter(receiving, mode);
        const id = crypto.randomUUID();
        target.frame({ type: 'message', id, sender: { id: 'bob', account: 'bob@example.test' },
          recipient: { id: 'alice', account: 'alice@example.test' }, receipts: true, text: '', images: [],
          sentAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
          attachments: [{ ...file, grant: JSON.stringify({ id: file.id, device: file.device }) }] });
        const failed = receiving.locator('.lounge-image-transfer');
        await expect(failed.getByRole('alert')).toBeVisible();
        await expect.poll(() => target.receipts.some(f => f.type === 'image-pending' && f.id === id)).toBe(true);
        expect(target.receipts.some(f => f.type === 'receipt' && f.id === id)).toBe(false);
        await capture(receiving, mode, 'unavailable');

        const restarted = await context.newPage();
        await enter(restarted, mode);
        const before = broker.relayFrames;
        await failed.getByRole('button').first().click();
        const image = receiving.locator('.lounge-message:not(.is-own) .lounge-image img').first();
        await expect(image).toBeVisible();
        await expect(image).toHaveJSProperty('naturalWidth', 32);
        await expect.poll(() => target.receipts.some(f => f.type === 'receipt' && f.id === id)).toBe(true);
        const uri = await image.getAttribute('src');
        expect(uri).toBe(pixel);
        expect(broker.recoveryRequests).toBeGreaterThan(0);
        expect(broker.relayFrames).toBeGreaterThan(before);
        await capture(receiving, mode, 'restored');
        await restarted.close();
        await receiving.reload();
        if (mode === 'mobile') {
          await receiving.getByRole('tab', { name: '发现', exact: true }).click();
          await receiving.locator('.discovery-lounge').click();
        } else await receiving.getByRole('button', { name: '在线交流', exact: true }).click();
        await receiving.getByRole('button', { name: '与 bob 私聊', exact: true }).filter({ visible: true }).click();
        await expect(image).toHaveAttribute('src', uri!);
      } finally { await receivingContext.close(); }
    });
}
