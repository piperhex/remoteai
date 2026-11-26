import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

declare global {
  interface Window { mappingPeerFixture: { starts: number; stops: number; ready(): void } }
}

const nav = (page: Page) => page.locator('.sidebar-tabs');
const hub = (page: Page) => page.getByRole('region', { name: '端口映射', exact: true });
const openHub = (page: Page) => nav(page).getByRole('button', { name: '端口映射', exact: true }).click();
const chooseStudio = (page: Page) => page.locator('.ant-select-dropdown:visible .ant-select-item-option')
  .filter({ hasText: 'Mac Studio' }).click();

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    for (const [device, ports] of [['office', [3389, 8080, 5000]], ['studio', [8443]]] as const) {
      const scope = JSON.stringify(['https://fixture.test', 'owner', device]);
      localStorage.setItem('codex-port-forwarding:' + scope, JSON.stringify(ports.map((port, i) => ({
        id: 'entry-' + port, remoteHost: i === 0 ? '192.168.5.188' : '192.168.5.3', remotePort: port,
        localPort: port, protocol: i === 0 ? 'both' : 'tcp', updatedAt: 1792116626000 - i,
      }))));
    }
  });
  // Keep the production handshake, per-device session, mapping service and tunnel. Supply the peer's RPC replies.
  await page.route('**/remote/desktopChatConnection.ts*', route => route.fulfill({ contentType: 'application/javascript',
    body: `export function desktopChatConnection(identity, id, events) {
      const files = window.portForwardingFixture.client;
      const peer = window.mappingPeerFixture;
      return { start() {
        if (!peer) { queueMicrotask(events.ready); return; }
        peer.starts++; events.error('retrying'); peer.ready = events.ready;
      }, stop() { if (peer) peer.stops++; }, retryNow() {}, setBulkSupport() {},
        mappingStreams: { open: files.stream }, request: async (kind, body) => {
          if (kind === 'connect') return {};
          if (body.operation === 'guiResourceOpen') return files.openResource(body.url);
          if (body.operation === 'guiResourceClose') return files.closeResource(body.id);
          if (body.operation === 'guiResourceLink') return files.link(body.id, body.request);
          throw Error('Unexpected fixture operation');
        } };
    }` }));
});

test('a pending peer can recover, share a connection and release its last listener', async ({ page }) => {
  await page.addInitScript(() => { window.mappingPeerFixture = { starts: 0, stops: 0, ready() {} }; });
  await page.goto('/e2e/port-forwarding-harness.html?hub');
  await openHub(page);
  await page.evaluate(() => window.portMappingSyncFixture.release());
  const first = hub(page).getByRole('article', { name: /127\.0\.0\.1:5000 →/ });
  const second = hub(page).getByRole('article', { name: /127\.0\.0\.1:8080 →/ });
  await first.getByRole('button', { name: /^启动映射/ }).click();
  await second.getByRole('button', { name: /^启动映射/ }).click();
  await first.getByRole('button', { name: /^停止映射/ }).click();
  await expect(first.getByRole('status')).toHaveText('已停止');
  expect(await page.evaluate(() => window.mappingPeerFixture.starts)).toBe(1);
  expect(await page.evaluate(() => window.mappingPeerFixture.stops)).toBe(0);
  await page.evaluate(() => window.mappingPeerFixture.ready());
  await expect(second.getByRole('status')).toHaveText('映射中');
  expect(await page.evaluate(() => [...window.portForwardingFixture.openedPorts])).toEqual([8080]);
  await second.getByRole('button', { name: /^停止映射/ }).click();
  await expect.poll(() => page.evaluate(() => window.mappingPeerFixture.stops)).toBe(1);
  expect(await page.evaluate(() => window.portForwardingFixture.openedPorts.size)).toBe(0);
});

for (const remote of [false, true]) {
  test(`desktop ${remote ? 'remote dark narrow' : 'local light wide'} sidebar manages mappings`, async ({ page }, info) => {
    await page.setViewportSize(remote ? { width: 930, height: 860 } : { width: 1400, height: 900 });
    await page.goto('/e2e/port-forwarding-harness.html?hub' + (remote ? '&mode=remote&dark&font=18' : ''), {
      waitUntil: 'domcontentloaded',
    });
    await openHub(page);
    await page.evaluate(() => window.portMappingSyncFixture.release());
    const screen = hub(page);
    const row = screen.getByRole('article', { name: /127\.0\.0\.1:5000 →/ });
    await row.getByRole('button', { name: /^启动映射/ }).click();
    await expect(row.getByRole('status')).toHaveText('映射中');
    await expect(screen.getByRole('article')).toHaveCount(4);
    await screen.getByRole('heading', { name: '端口映射' }).hover();
    const prefix = remote ? 'pc-remote-dark-narrow' : 'pc-local-light-wide';
    await page.screenshot({ path: info.outputPath(prefix + '-list.png'), animations: 'disabled' });
    await screen.getByRole('button', { name: '新建映射' }).click();
    const dialog = page.getByRole('dialog');
    const tcp = dialog.getByRole('radio', { name: 'TCP', exact: true });
    await expect(tcp).toBeChecked();
    expect(await tcp.evaluate(input => parseFloat(getComputedStyle(input.closest('label')!).fontSize)))
      .toBeGreaterThanOrEqual(12);
    await dialog.locator('.ant-select-selector').click();
    await chooseStudio(page);
    await dialog.getByRole('spinbutton', { name: '远程端口' }).fill('5000');
    await dialog.getByRole('textbox', { name: '自定义域名' }).fill('studio.localhost');
    await page.screenshot({ path: info.outputPath(prefix + '-create.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('这个本地端口已用于其他映射');
    await dialog.getByRole('spinbutton', { name: '本地端口' }).fill('15000');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    const saved = screen.getByRole('article', { name: /studio\.localhost:15000 →/ });
    await expect(saved.getByRole('status')).toHaveText('已停止');
    await saved.getByRole('button', { name: /^更多操作/ }).click();
    await page.getByRole('menuitem', { name: '修改别名' }).click();
    await dialog.getByRole('textbox', { name: '别名' }).fill('Studio API');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(saved).toContainText('Studio API');
    await saved.getByRole('button', { name: /^编辑映射/ }).click();
    await expect(dialog.getByRole('textbox', { name: '自定义域名' })).toHaveValue('studio.localhost');
    await dialog.getByRole('textbox', { name: '目标 IP' }).fill('192.168.5.4');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(saved).toContainText('192.168.5.4:5000');
    await nav(page).getByRole('button', { name: 'Agent Hub' }).click();
    if (remote) {
      await page.locator('main').getByRole('button', { name: '端口映射', exact: true }).click();
      const same = dialog.getByRole('article', { name: /127\.0\.0\.1:5000 →/ });
      await expect(same.getByRole('status')).toHaveText('映射中');
      await same.getByRole('button', { name: /^停止映射/ }).click();
      await page.keyboard.press('Escape');
    }
    await openHub(page);
    await expect(row.getByRole('status')).toHaveText(remote ? '已停止' : '映射中');
    if (!remote) await row.getByRole('button', { name: /^停止映射/ }).click();
    await screen.getByRole('combobox', { name: '选择电脑' }).press('ArrowDown');
    await chooseStudio(page);
    await expect(screen.getByRole('article')).toHaveCount(2);
    await saved.getByRole('button', { name: /^更多操作/ }).click();
    await page.getByRole('menuitem', { name: '删除映射' }).click();
    await expect(saved).toHaveCount(0);
  });
}
