import { expect, test, type Page } from '@playwright/test';

const panel = (page: Page) => page.getByRole('region', { name: '端口映射设置' });
const entry = (page: Page, label: string) => panel(page).getByRole('article', { name: label });
const closePanel = (page: Page) => page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
declare global {
  interface Window {
    portForwardingFixture: {
      targetUrls: string[]; clipboard: string[]; browserUrls: string[]; previewUrls: string[];
      resolvedUrls: string[]; failBrowser: boolean;
      browserRoutes: { domain: string; port: number }[];
      openedPorts: Set<number>; openedUdpPorts: Set<number>;
    };
  }
}
async function add(page: Page, remotePort: number, localPort: number) {
  const create = page.getByRole('dialog').getByRole('button', { name: '新建映射', exact: true });
  const remoteInput = panel(page).getByRole('spinbutton', { name: '远程端口' });
  await expect(create.or(remoteInput)).toBeVisible();
  if (await create.isVisible()) await create.click();
  await remoteInput.fill(String(remotePort));
  await panel(page).getByRole('spinbutton', { name: '本地端口' }).fill(String(localPort));
  await page.getByRole('dialog').getByRole('button', { name: '添加并启动' }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.goto('/e2e/port-forwarding-harness.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '端口映射', exact: true }).click();
});

test('opens separate forms, discards drafts, and uses optional defaults', async ({ page }) => {
  await expect(panel(page).getByRole('textbox')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: '新建映射', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新建映射', exact: true })).toBeVisible();
  await expect(panel(page).getByRole('article')).toHaveCount(0);
  await panel(page).getByRole('spinbutton', { name: '远程端口' }).fill('3002');
  await page.getByRole('button', { name: '返回映射列表' }).click();
  await expect(panel(page)).toContainText('还没有端口映射');
  await page.getByRole('dialog').getByRole('button', { name: '新建映射', exact: true }).click();
  await expect(panel(page).getByRole('spinbutton', { name: '远程端口' })).toHaveValue('');
  await page.screenshot({ path: '../../.codex-tmp/port-forwarding-create.png', animations: 'disabled' });
  await panel(page).getByRole('spinbutton', { name: '远程端口' }).fill('3002');
  await page.getByRole('dialog').getByRole('button', { name: '添加并启动' }).click();
  const mapping = entry(page, '127.0.0.1:3002 → 127.0.0.1:3002');
  await expect(mapping.getByRole('status')).toHaveText('映射中');
  await mapping.getByRole('button', { name: /^编辑映射/ }).click();
  await expect(page.getByRole('heading', { name: '编辑映射', exact: true })).toBeVisible();
  await expect(panel(page).getByRole('article')).toHaveCount(0);
  await expect(panel(page).getByText('最近编辑', { exact: false })).toBeVisible();
  await panel(page).getByRole('textbox', { name: '目标 IP' }).fill('::1');
  await expect(panel(page).getByText('[::1]:3002', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '端口映射', exact: true }).click();
  await expect(mapping).toBeVisible();
  await expect(panel(page).getByRole('textbox')).toHaveCount(0);
  await mapping.getByRole('button', { name: /^停止映射/ }).click();
  await expect(mapping.getByRole('status')).toHaveText('已停止');
  await mapping.getByRole('button', { name: /^复制本地地址/ }).click();
  expect(await page.evaluate(() => window.portForwardingFixture.clipboard)).toEqual(['127.0.0.1:3002']);
});

test('copies and opens a custom domain and restores the IP address after clearing it', async ({ page }, info) => {
  await page.setViewportSize({ width: 540, height: 760 });
  await page.getByRole('dialog').getByRole('button', { name: '新建映射', exact: true }).click();
  await panel(page).getByRole('spinbutton', { name: '远程端口' }).fill('3000');
  await panel(page).getByRole('spinbutton', { name: '本地端口' }).fill('13000');
  const domain = panel(page).getByRole('textbox', { name: '自定义域名' });
  const start = page.getByRole('dialog').getByRole('button', { name: '添加并启动' });
  await domain.fill('https://app.localhost/');
  await start.click();
  await expect(panel(page).getByRole('alert')).toContainText('请输入域名');
  await domain.fill('Test.Local');
  const alias = panel(page).getByRole('textbox', { name: '别名', exact: true });
  await alias.fill('Office API');
  await start.click();
  const mapping = entry(page, 'test.local:13000 → 127.0.0.1:3000');
  await expect(mapping.getByRole('status')).toHaveText('映射中');
  await expect(mapping.getByText('Office API', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.portForwardingFixture.browserRoutes))
    .toEqual([{ domain: 'test.local', port: 13000 }]);
  await mapping.getByRole('button', { name: /^复制本地地址/ }).click();
  expect(await page.evaluate(() => window.portForwardingFixture.clipboard)).toEqual(['test.local:13000']);
  await mapping.getByRole('button', { name: 'test.local:13000', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '在 Remote AI 中预览' })).toBeVisible();
  const openInBrowser = page.getByRole('menuitem', { name: '在浏览器中打开', exact: true });
  await expect(openInBrowser).toHaveCount(0);
  await expect(page.locator('.ant-dropdown:visible')).not.toHaveClass(/-appear|-enter/);
  await expect(page.getByText('本地地址已复制', { exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath('pc-remote-domain-open.png'), animations: 'disabled' });
  await page.getByRole('menuitem', { name: '在 Remote AI 中预览' }).click();
  await expect.poll(() => page.evaluate(() => window.portForwardingFixture.previewUrls))
    .toContain('http://test.local:13000');
  await page.reload();
  await page.getByRole('button', { name: '端口映射', exact: true }).click();
  await mapping.getByRole('button', { name: /^编辑映射/ }).click();
  await expect(domain).toHaveValue('test.local');
  await expect(alias).toHaveValue('Office API');
  await alias.fill('');
  await domain.fill('');
  await page.getByRole('button', { name: '保存修改' }).click();
  const restored = entry(page, '127.0.0.1:13000 → 127.0.0.1:3000');
  await expect(restored.getByText('未命名', { exact: true })).toBeVisible();
  await restored.getByRole('button', { name: /^启动映射/ }).click();
  await restored.getByRole('button', { name: '127.0.0.1:13000', exact: true }).click();
  await expect(openInBrowser).toBeVisible();
  await expect(page.locator('.ant-dropdown:visible')).not.toHaveClass(/-appear|-enter/);
  await page.screenshot({ path: info.outputPath('pc-remote-domain-cleared.png'), animations: 'disabled' });
  await openInBrowser.click();
  await expect.poll(() => page.evaluate(() => window.portForwardingFixture.browserUrls))
    .toEqual(['http://127.0.0.1:13000']);
});

test('keeps eight cards and the form usable in a small window', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('codex-port-forwarding:port-forwarding-e2e/Office PC',
    JSON.stringify(Array.from({ length: 8 }, (_, index) => ({ id: `layout-${index}`,
      remoteHost: index === 7 ? '2001:db8:1234:5678:9abc:def0:1234:5678' : '172.16.200.56',
      remotePort: 3000 + index, localPort: 13000 + index, updatedAt: 1792116626000, protocol: 'tcp' })))));
  await page.reload();
  await page.getByRole('button', { name: '端口映射', exact: true }).click();
  await expect(panel(page).getByRole('article')).toHaveCount(8);
  await expect(page.getByRole('dialog').getByRole('button', { name: '新建映射', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 640 });
  const last = panel(page).getByRole('article').last();
  await last.getByRole('button', { name: /^删除映射/ }).click();
  const confirmation = page.locator('.ant-popconfirm:visible');
  await expect(confirmation).toContainText('确认删除');
  expect((await confirmation.boundingBox())!.width).toBeLessThanOrEqual(360);
  await confirmation.getByRole('button', { name: '删除映射', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '新建映射', exact: true })).toBeEnabled();
  await panel(page).getByRole('article').last().getByRole('button', { name: /^编辑映射/ }).click();
  await expect(page.getByRole('heading', { name: '编辑映射', exact: true })).toBeVisible();
  expect(await panel(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: '保存修改' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('dialog').getByRole('button', { name: '保存修改' })).toBeInViewport();
  await page.screenshot({ path: '../../.codex-tmp/port-forwarding-small-edit.png', animations: 'disabled' });
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel(page).getByRole('article')).toHaveCount(7);
});

test('selects UDP or both, persists edits, and keeps protocol controls within a narrow panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('dialog').getByRole('button', { name: '新建映射', exact: true }).click();
  await panel(page).getByText('UDP', { exact: true }).click();
  await expect(panel(page).getByRole('radio', { name: 'UDP', exact: true })).toBeChecked();
  await add(page, 53, 1053);
  const mapping = entry(page, '127.0.0.1:1053 → 127.0.0.1:53');
  await expect(mapping.getByRole('status')).toHaveText('映射中');
  await expect(mapping.getByRole('button', { name: '127.0.0.1:1053', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.portForwardingFixture.openedUdpPorts.has(1053))).toBe(true);
  await mapping.getByRole('button', { name: /^编辑映射/ }).click();
  await panel(page).getByText('TCP + UDP', { exact: true }).click();
  await expect(panel(page).getByRole('radio', { name: 'TCP + UDP', exact: true })).toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: '保存修改' }).click();
  await expect(mapping.getByRole('status')).toHaveText('映射中');
  await expect(mapping.getByRole('button', { name: '127.0.0.1:1053', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.portForwardingFixture.openedPorts.has(1053))).toBe(true);
  expect(await panel(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '../../.codex-tmp/port-forwarding-udp-narrow.png' });
  await page.reload();
  await page.getByRole('button', { name: '端口映射', exact: true }).click();
  await expect(mapping.getByText('TCP + UDP', { exact: true })).toBeVisible();
  await expect(mapping.getByRole('status')).toHaveText('已停止');
});

test('maps a selected IP and restores it after reload', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: '新建映射', exact: true }).click();
  await panel(page).getByRole('textbox', { name: '目标 IP' }).fill('192.168.1.20:3000');
  await add(page, 3000, 13000);
  await expect(panel(page).getByRole('alert')).toHaveText('请输入有效的 IPv4 或 IPv6 地址。');
  await panel(page).getByRole('textbox', { name: '目标 IP' }).fill('192.168.1.20');
  await page.getByRole('dialog').getByRole('button', { name: '添加并启动' }).click();
  await expect(entry(page, '127.0.0.1:13000 → 192.168.1.20:3000').getByRole('status')).toHaveText('映射中');
  expect(await page.evaluate(() => window.portForwardingFixture.targetUrls)).toEqual(['http://192.168.1.20:3000']);
  await page.reload(); await page.getByRole('button', { name: '端口映射', exact: true }).click();
  await expect(entry(page, '127.0.0.1:13000 → 192.168.1.20:3000').getByRole('status')).toHaveText('已停止');
  await entry(page, '127.0.0.1:13000 → 192.168.1.20:3000').getByRole('button', { name: /^启动映射/ }).click();
  expect(await page.evaluate(() => window.portForwardingFixture.targetUrls)).toEqual(['http://192.168.1.20:3000']);
  await page.screenshot({ path: '../../.codex-tmp/port-forwarding-target-ip.png', animations: 'disabled' });
});

test('edits an active mapping, cancels drafts and retains the edited settings after reload', async ({ page }) => {
  await add(page, 3000, 13000);
  await entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: /^编辑映射/ }).click();
  await panel(page).getByRole('spinbutton', { name: '本地端口' }).fill('14000');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('status')).toHaveText('映射中');
  await entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: /^编辑映射/ }).click();
  const host = panel(page).getByRole('textbox', { name: '目标 IP' });
  await host.fill('172.16.200.85');
  await expect(host).toHaveCSS('user-select', 'text');
  await host.press('ControlOrMeta+a');
  expect(await host.evaluate((input: HTMLInputElement) =>
    input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0))).toBe('172.16.200.85');
  await panel(page).getByRole('spinbutton', { name: '远程端口' }).fill('8306');
  await panel(page).getByRole('spinbutton', { name: '本地端口' }).fill('8306');
  const title = page.getByRole('heading', { name: '编辑映射', exact: true });
  await expect(title).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
  await title.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.screenshot({ path: '../../.codex-tmp/port-forwarding-edit.png', animations: 'disabled' });
  await page.getByRole('dialog').getByRole('button', { name: '保存修改' }).click();
  await expect(panel(page).getByRole('article')).toHaveCount(1);
  await expect(entry(page, '127.0.0.1:8306 → 172.16.200.85:8306').getByRole('status')).toHaveText('映射中');
  await add(page, 3000, 13000); // The original listener was released and its port is reusable.
  await expect(entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('status')).toHaveText('映射中');
  await page.reload(); await page.getByRole('button', { name: '端口映射', exact: true }).click();
  await expect(entry(page, '127.0.0.1:8306 → 172.16.200.85:8306').getByRole('status')).toHaveText('已停止');
});

test('multiple mappings, port conflicts, stop, copy and reconnect stay independent', async ({ page }) => {
  await add(page, 3000, 13000); await add(page, 5432, 15432);
  await expect(entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('status')).toHaveText('映射中');
  await expect(entry(page, '127.0.0.1:15432 → 127.0.0.1:5432').getByRole('status')).toHaveText('映射中');
  await entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: '复制本地地址 127.0.0.1:13000 → 127.0.0.1:3000' }).click();
  expect(await page.evaluate(() => window.portForwardingFixture.clipboard)).toEqual(['127.0.0.1:13000']);
  await entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: '停止映射 127.0.0.1:13000 → 127.0.0.1:3000' }).click();
  await expect(entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('status')).toHaveText('已停止');
  await page.getByRole('heading', { name: '端口映射', exact: true }).hover();
  await expect(panel(page).getByRole('button', { name: /^启动映射/ })).toHaveCSS('background-color', 'rgb(25, 107, 62)');
  await expect(panel(page).getByRole('button', { name: /^停止映射/ })).toHaveCSS('background-color', 'rgb(170, 49, 56)');
  await expect(entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: '127.0.0.1:13000', exact: true })).toBeDisabled();
  await expect(entry(page, '127.0.0.1:15432 → 127.0.0.1:5432').getByRole('status')).toHaveText('映射中');
  await add(page, 8080, 9999);
  await expect(entry(page, '127.0.0.1:9999 → 127.0.0.1:8080').getByRole('alert')).toHaveText('本地端口已被占用，请换一个端口。');
  await entry(page, '127.0.0.1:9999 → 127.0.0.1:8080').getByRole('button', { name: /^删除映射/ }).click();
  await page.getByRole('button', { name: '删除映射', exact: true }).click();
  await add(page, 8080, 15432);
  await expect(panel(page).getByRole('alert')).toHaveText('这个本地端口已有映射。');
  await closePanel(page);
  await page.getByRole('button', { name: '断开连接', exact: true }).click();
  await page.getByRole('button', { name: '端口映射', exact: true }).click();
  await expect(entry(page, '127.0.0.1:15432 → 127.0.0.1:5432').getByRole('status')).toHaveText('已停止');
  await expect(panel(page).getByRole('button', { name: '启动映射 127.0.0.1:15432 → 127.0.0.1:5432' })).toBeDisabled();
  await expect(entry(page, '127.0.0.1:15432 → 127.0.0.1:5432').getByRole('button', { name: '127.0.0.1:15432', exact: true })).toBeDisabled();
  await closePanel(page);
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await page.getByRole('button', { name: '端口映射', exact: true }).click();
  await panel(page).getByRole('button', { name: '启动映射 127.0.0.1:15432 → 127.0.0.1:5432' }).click();
  await expect(entry(page, '127.0.0.1:15432 → 127.0.0.1:5432').getByRole('status')).toHaveText('映射中');
});

test('opens the mapped local address in the preview drawer and system browser', async ({ page }) => {
  await add(page, 3000, 13000);
  await entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: '127.0.0.1:13000', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: '在 Remote AI 中预览' })).toBeVisible();
  expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: '../../.codex-tmp/port-forwarding-link-menu.png', animations: 'disabled' });
  await menu.getByRole('menuitem', { name: '在 Remote AI 中预览' }).click();
  const preview = page.getByRole('region', { name: '网页预览' });
  await expect(preview.getByRole('combobox', { name: '页面地址' })).toHaveValue('http://127.0.0.1:13000');
  await expect.poll(() => page.evaluate(() => window.portForwardingFixture.previewUrls))
    .toContain('http://127.0.0.1:13000');
  await expect(panel(page)).toBeHidden();
  await page.getByRole('button', { name: '在浏览器中打开', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.portForwardingFixture.browserUrls))
    .toEqual(['http://127.0.0.1:13000']);
  await page.getByRole('button', { name: '关闭详情抽屉' }).click();
  await page.getByRole('button', { name: '端口映射', exact: true }).click();
  const address = entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: '127.0.0.1:13000', exact: true });
  await address.focus(); await page.keyboard.press('Enter');
  await menu.getByRole('menuitem', { name: '在浏览器中打开' }).click();
  await expect.poll(() => page.evaluate(() => window.portForwardingFixture.browserUrls))
    .toEqual(['http://127.0.0.1:13000', 'http://127.0.0.1:13000']);
  expect(await page.evaluate(() => window.portForwardingFixture.resolvedUrls)).toEqual([]);
  await expect(panel(page)).toBeHidden();
});

test('reports browser failures without exposing internal details', async ({ page }) => {
  await add(page, 3000, 13000);
  await page.evaluate(() => { window.portForwardingFixture.failBrowser = true; });
  await entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: '127.0.0.1:13000', exact: true }).click();
  await page.getByRole('menuitem', { name: '在浏览器中打开' }).click();
  await expect(page.getByText('链接暂时无法打开，请稍后重试。')).toBeVisible();
  await expect(page.getByText('Private browser failure')).toHaveCount(0);
});

test('keeps mappings by computer, restores settings, and fits compact light and dark views', async ({ page }) => {
  await add(page, 3000, 13000);
  await page.screenshot({ path: '../../.codex-tmp/port-forwarding-light.png', animations: 'disabled' });
  const launcher = page.getByRole('button', { name: '端口映射', exact: true });
  const forwarding = await launcher.boundingBox();
  const desktop = await page.getByRole('button', { name: '打开远程桌面' }).boundingBox();
  expect(forwarding!.x + forwarding!.width).toBeLessThan(desktop!.x);
  await closePanel(page); await page.getByRole('button', { name: '切换电脑' }).click();
  await launcher.click(); await expect(panel(page)).toContainText('还没有端口映射');
  await closePanel(page); await page.getByRole('button', { name: '切换电脑' }).click();
  await launcher.click(); await expect(entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('status')).toHaveText('映射中');
  await page.reload(); await launcher.click();
  await expect(entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('status')).toHaveText('已停止');
  for (const width of [1280, 560]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(async () => {
      const bounds = await panel(page).boundingBox();
      return !!bounds && bounds.width <= 720 && bounds.x >= 0 && bounds.x + bounds.width <= width;
    }).toBe(true);
  }
  await closePanel(page); await page.getByRole('button', { name: '切换深色' }).click(); await launcher.click();
  await expect(entry(page, '127.0.0.1:13000 → 127.0.0.1:3000')).toBeVisible();
  await entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: '启动映射 127.0.0.1:13000 → 127.0.0.1:3000' }).click();
  await entry(page, '127.0.0.1:13000 → 127.0.0.1:3000').getByRole('button', { name: '127.0.0.1:13000', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '在 Remote AI 中预览' })).toBeVisible();
  const menuBounds = await page.getByRole('menu').boundingBox();
  expect(menuBounds!.width).toBeLessThanOrEqual(400);
  expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(560);
  await page.screenshot({ path: '../../.codex-tmp/port-forwarding-dark.png', animations: 'disabled' });
});
