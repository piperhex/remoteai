import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { setupLounge } from './lounge-support';
import { AttachmentBroker } from './lounge-attachments-support';
import { samplePdf, previewSamples } from './preview-samples';
import type { LoungeAttachment } from '../../../shared/lounge/attachments';

const report = '330133519303-电子发票-26117000001706557538-20261030-155111.pdf';
test.setTimeout(180_000);
async function openLounge(page: Page, mode: string) {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  const mobile = mode.startsWith('mobile');
  if (mobile) await page.setViewportSize({ width: mode === 'mobile-320' ? 320 : 390, height: 844 });
  const web = mode === 'web' || mobile;
  const lounge = await setupLounge(page, web);
  await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
  await lounge.ready();
  lounge.frame({ type: 'ready', user: { id: 'alice', account: 'alice@example.test' }, attachments: true,
    direct: true, receipts: true, blocked: [] });
  if (mobile) {
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    await page.locator('.discovery-lounge').click();
  } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
  lounge.private('文件预览与下载');
  await page.getByRole('button', { name: '与 bob 私聊', exact: true }).filter({ visible: true }).click();
  return lounge;
}
async function receive(page: Page, mode: string, body: Buffer, name: string, sender: Page) {
  const source = await openLounge(sender, 'local');
  await sender.locator('.lounge-file-control input').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: body });
  await expect.poll(() => source.sent.length).toBe(1);
  const file = (source.sent[0] as typeof source.sent[0] & { attachments: LoungeAttachment[] }).attachments[0];
  const target = await openLounge(page, mode);
  target.frame({ type: 'message', id: crypto.randomUUID(), sender: { id: 'bob', account: 'bob@example.test' },
    recipient: { id: 'alice', account: 'alice@example.test' }, text: '', images: [],
    attachments: [{ ...file, grant: JSON.stringify({ id: file.id, device: file.device }) }],
    sentAt: new Date().toISOString(), receipts: true });
  return page.locator('.lounge-message:not(.is-own) .lounge-file-card').filter({ hasText: name }).last();
}
async function downloadTasks(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('codex-switch.web.downloads.v1');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return new Promise<{ id: string; status: string; name: string; received: number }[]>((resolve, reject) => {
      const request = database.transaction('tasks').objectStore('tasks').getAll();
      request.onsuccess = () => { database.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    });
  });
}
for (const mode of ['local', 'remote', 'web', 'mobile', 'mobile-320']) {
  test(`${mode}: received PDF card, preview and persistent downloads`, async ({ page, context }) => {
    const broker = new AttachmentBroker(); await broker.install(context);
    const sender = await context.newPage();
    const card = await receive(page, mode, samplePdf(), report, sender);
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('复制链接');
    await page.screenshot({ path: `../../.codex-tmp/lounge-file-cards/${mode}-received.png` });
    await sender.screenshot({ path: `../../.codex-tmp/lounge-file-cards/${mode}-sent.png` });
    if (mode.startsWith('mobile')) {
      await expect(card.getByRole('button', { name: '下载', exact: true })).toHaveCount(0);
      await card.getByRole('button').click();
      await expect(page.locator('.lounge-file-sheet').getByRole('button', { name: '预览', exact: true })).toBeVisible();
      await expect(page.locator('.lounge-file-sheet .ant-drawer-content-wrapper')).toHaveCSS('transform', 'none');
      await page.screenshot({ path: `../../.codex-tmp/lounge-file-cards/${mode}-actions.png`, animations: 'disabled' });
    }
    await (mode.startsWith('mobile') ? page.locator('.lounge-file-sheet') : card)
      .getByRole('button', { name: '预览', exact: true }).click();
    await expect(page.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.file-pdf-toolbar')).toContainText('2 / 2');
    await expect(page.locator('.file-pdf-page[data-pdf-page="2"] canvas')).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/lounge-file-cards/${mode}-pdf.png` });
    await page.locator('.lounge-file-preview-tools').getByRole('button', { name: '下载', exact: true }).click();
    await expect.poll(async () => (await downloadTasks(page))[0]?.status).toBe('ready');
    expect((await downloadTasks(page))[0]).toMatchObject({ name: report, received: samplePdf().length });
    await page.locator('.lounge-file-preview .ant-modal-close').click();
    if (mode.startsWith('mobile')) {
      await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
      await page.getByRole('button', { name: '返回发现', exact: true }).click();
      await page.getByRole('button', { name: '下载管理', exact: true }).click();
    } else await page.getByRole('button', { name: '下载管理', exact: true }).click();
    await expect(page.getByText(report, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/lounge-file-cards/${mode}-downloads.png` });
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存到设备', exact: true }).first().click();
    expect(await readFile((await (await saved).path())!)).toEqual(samplePdf());
    expect(broker.relayFrames).toBeGreaterThan(0);
    await sender.close();
  });
}

test('rendered files remain isolated and unsupported files offer downloads only', async ({ page, context }) => {
  const broker = new AttachmentBroker(); await broker.install(context);
  const sender = await context.newPage();
  const samples = { ...previewSamples(), 'config.json': Buffer.from('{"preview":true,"message":"完整中文"}'),
    'source.ts': Buffer.from('const greeting = "完整中文";'), 'archive.zip': Buffer.from('archive') };
  for (const name of ['guide.md', 'page.html', 'config.json', 'source.ts', 'image.svg', 'sound.wav', 'video.mp4', 'archive.zip']) {
    const card = await receive(page, 'local', samples[name as keyof typeof samples], name, sender);
    if (name.endsWith('.zip')) {
      await expect(card.getByRole('button', { name: '预览', exact: true })).toHaveCount(0); continue;
    }
    await card.getByRole('button', { name: '预览', exact: true }).click();
    const content = page.locator('.lounge-file-preview-content');
    if (name.endsWith('.md')) await expect(content.getByRole('heading', { name: 'Preview heading' })).toBeVisible();
    if (name.endsWith('.html')) {
      await expect(content.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
      await expect(content.frameLocator('iframe').getByRole('heading', { name: 'HTML preview' })).toBeVisible();
      expect(await page.evaluate(() => document.body.dataset.escaped)).toBeUndefined();
    }
    if (name.endsWith('.json')) await expect(content.locator('.cm-content')).toContainText('完整中文');
    if (name.endsWith('.ts')) await expect(content).toContainText('const greeting');
    if (name.endsWith('.svg')) await expect(content.locator('img')).toBeVisible();
    if (name.endsWith('.wav')) await expect(content.locator('audio')).toBeVisible();
    if (name.endsWith('.mp4')) await expect(content.locator('video')).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/lounge-file-cards/preview-${name}.png` });
    await page.locator('.lounge-file-preview .ant-modal-close').click();
  }
});

for (const mode of ['local', 'remote', 'web', 'mobile', 'mobile-320']) {
  test(`${mode}: dark file cards preserve right click and touch menus`, async ({ page, context }) => {
    const broker = new AttachmentBroker(); await broker.install(context);
    const sender = await context.newPage();
    const card = await receive(page, mode, samplePdf(), report, sender);
    await page.evaluate(() => {
      if (window.loungeFixture) window.loungeFixture.setTheme('dark');
      else window.dispatchEvent(new StorageEvent('storage', { key: 'codex-switch.web.theme.v1', newValue: 'dark' }));
    });
    await expect(card).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/lounge-file-cards/${mode}-dark.png` });
    let labels: string[] = [];
    for (const touch of [false, true]) {
      if (!touch) await card.click({ button: 'right' });
      else {
        const pointer = { pointerId: 8, pointerType: 'touch', isPrimary: true, button: 0 };
        await card.dispatchEvent('pointerdown', pointer);
        await expect(page.getByRole('menu')).toBeVisible();
        await card.dispatchEvent('pointerup', pointer);
      }
      await expect(page.getByRole('menu')).toBeVisible();
      const current = await page.getByRole('menuitem').allTextContents();
      if (touch) expect(current).toEqual(labels); else labels = current;
      expect(current.join(' ')).not.toContain('复制链接');
      await page.keyboard.press('Escape');
    }
    if (mode.startsWith('mobile')) {
      await card.getByRole('button').click();
      await expect(page.locator('.lounge-file-sheet')).toBeVisible();
      await expect(page.locator('.lounge-file-sheet .ant-drawer-content-wrapper')).toHaveCSS('transform', 'none');
      await page.screenshot({ path: `../../.codex-tmp/lounge-file-cards/${mode}-dark-actions.png`, animations: 'disabled' });
    }
    if (mode === 'local') {
      await context.setOffline(true);
      for (const [language, preview] of [['en', 'Preview'], ['ja', 'プレビュー'], ['ru', 'Предпросмотр']] as const) {
        await page.evaluate(value => window.loungeFixture.setLanguage(value), language);
        await expect(card.getByRole('button', { name: preview, exact: true })).toBeVisible();
        await page.screenshot({ path: `../../.codex-tmp/lounge-file-cards/local-dark-${language}.png` });
      }
    }
    await sender.close();
  });
}
