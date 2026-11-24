import { expect, test, type Page } from '@playwright/test';

async function imagePair(page: Page) {
  return page.evaluate(() => [480, 960].map(width => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = width / 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(width / 480, width / 480);
    ctx.fillStyle = '#ecf3f1'; ctx.fillRect(0, 0, 480, 240);
    ctx.fillStyle = '#244941'; ctx.font = 'bold 22px sans-serif'; ctx.fillText('每周访问量', 28, 44);
    ctx.fillStyle = '#47645e'; ctx.font = '14px sans-serif';
    ctx.fillText(width === 480 ? '预览图 · 480 × 240' : '原图 · 960 × 480', 28, 70);
    [48, 74, 60, 90, 68, 98, 112].forEach((height, index) => {
      ctx.fillStyle = index === 6 ? '#236b60' : '#83b7a9';
      ctx.fillRect(32 + index * 62, 200 - height, 40, height);
    });
    return canvas.toDataURL();
  }));
}

async function openCopy(page: Page, touch: boolean) {
  const copy = page.getByRole('menuitem', { name: '复制图片', exact: true });
  await expect(copy).toBeHidden();
  const stage = page.locator('.cs-image-stage');
  if (touch) {
    const { width, height } = (await stage.boundingBox())!;
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: height / 2 }] });
    await expect(copy).toBeVisible();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else await stage.click({ button: 'right' });
  await expect(copy).toBeVisible();
  await copy.hover();
  await expect(page.locator('.ant-dropdown:visible').filter({ has: copy })).toHaveCSS('opacity', '1');
  return copy;
}

async function clipboardMatches(page: Page, source: string) {
  return page.evaluate(async url => {
    const [item] = await navigator.clipboard.read();
    if (!item?.types.includes('image/png')) return false;
    const pixels = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      return canvas.toDataURL();
    };
    return await pixels(await item.getType('image/png')) === await pixels(await (await fetch(url)).blob());
  }, source);
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: copies the displayed preview and switches to original pixels as soon as they load`, async (
    { page, context }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.setViewportSize({ width: 1280, height: 800 });
    const [thumb, full] = await imagePair(page);
    const source = 'C:/charts/weekly.png';
    let release!: () => void;
    const transfer = new Promise<void>(resolve => { release = resolve; });
    let originals = 0;
    await page.route('**/history-fixture.json', route => route.fulfill({ json: {
      thread: { id: 'copy', cwd: '', preview: '', updatedAt: 1 }, activeTurn: null, tokens: 0, error: '',
      turns: [{ id: 'turn', status: 'completed', items: [{ id: 'reply', type: 'agentMessage',
        text: `![访问量图表](${source})` }] }],
    } }));
    await page.route(/(image-preview\.json|__codex_switch__\/api\/invoke)$/, async route => {
      const body = route.request().postDataJSON();
      const original = body.original === true || body.args?.request.variant === 'original';
      if (original) { originals++; await transfer; }
      const data = { url: original ? full : thumb };
      await route.fulfill({ json: body.args ? { ok: true, result: { data } } : data });
    });
    await page.goto(`/e2e/image-history-harness.html?mode=${mode}&editor`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '放大查看：访问量图表', exact: true }).click();
    const image = page.locator('.cs-image-stage img');
    await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(480);
    const copy = await openCopy(page, false);
    await page.screenshot({ path: info.outputPath(`${mode}-thumbnail-menu.png`), animations: 'disabled' });
    await copy.click();
    await expect(page.getByText('图片已复制', { exact: true })).toBeVisible();
    await expect.poll(() => clipboardMatches(page, thumb)).toBe(true);
    expect(originals).toBe(mode === 'local' ? 1 : 0);
    if (mode !== 'local') await page.getByRole('button', { name: '查看原图', exact: true }).click();
    await openCopy(page, true);
    release();
    await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(960);
    await page.screenshot({ path: info.outputPath(`${mode}-original-long-press.png`), animations: 'disabled' });
    await copy.click();
    await expect.poll(() => clipboardMatches(page, full)).toBe(true);
    await expect(page.getByText('图片已复制', { exact: true })).toBeVisible();
    expect(originals).toBe(1);
  });
}

test('the browser can target the displayed image when clipboard APIs are unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'ClipboardItem', { value: undefined }));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.goto('/e2e/image-viewer-drag-harness.html?mode=web', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '放大查看：拖动测试', exact: true }).click();
  const image = page.locator('.cs-image-browser-menu img');
  await expect(image).toBeVisible();
  await image.evaluate(node => document.addEventListener('contextmenu', event => {
    node.dataset.imageMenu = String(event.target === node && !event.defaultPrevented);
  }));
  await image.click({ button: 'right' });
  await expect(image).toHaveAttribute('data-image-menu', 'true');
  await image.evaluate(node => document.addEventListener('pointerdown', event => {
    node.dataset.imageTouch = String(event.target === node && !event.defaultPrevented);
  }, { once: true }));
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, configuration: 'mobile' });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 480, y: 320 }] });
  await expect(image).toHaveAttribute('data-image-touch', 'true');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
});
