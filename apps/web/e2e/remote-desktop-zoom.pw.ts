import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }
type Touch = { x: number; y: number; id: number };
test.use({ isMobile: true, hasTouch: true });

async function openDesktop(page: Page) {
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
}

async function touchDriver(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 3 });
  return async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: Touch[]) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  };
}

test('keeps the desktop open when the separate chat connection drops', async ({ page }) => {
  await openDesktop(page);
  const bounds = await page.locator('video').boundingBox();
  await page.locator('#disconnect-chat').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('dialog', { name: '远程桌面' })).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭连接状态' })).toBeVisible();
  expect(await page.locator('video').boundingBox()).toEqual(bounds);
});

test('fits the complete desktop inside the available stage after resizing', async ({ page }, info) => {
  await openDesktop(page);
  const sizes = [page.viewportSize()!, { width: 900, height: 650 },
    { width: 2048, height: 1122 }, { width: 2560, height: 900 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expect(async () => {
      const stage = (await page.locator('.rd-stage').boundingBox())!;
      const video = (await page.locator('video').boundingBox())!;
      expect(video.x).toBeGreaterThanOrEqual(stage.x);
      expect(video.y).toBeGreaterThanOrEqual(stage.y);
      expect(video.x + video.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
      expect(video.y + video.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
      expect(video.width / video.height).toBeCloseTo(16 / 9);
      expect(video.width).toBeCloseTo(Math.min(stage.width, stage.height * 16 / 9), 0);
      expect(video.x + video.width / 2).toBeCloseTo(stage.x + stage.width / 2, 0);
      expect(video.y + video.height / 2).toBeCloseTo(stage.y + stage.height / 2, 0);
    }).toPass();
    await page.screenshot({ path: info.outputPath(`desktop-fit-${size.width}x${size.height}.png`) });
  }
});

test('shows live multiline stats with a close button on the right and can restore them from display settings',
  async ({ page }, info) => {
    await openDesktop(page);
    const stats = page.locator('.rd-stats');
    await expect(stats).toContainText('fps'); await expect(stats).toContainText('Mbps');
    await expect.poll(() => stats.innerText()).toMatch(/\d+ fps/);
    await expect.poll(() => stats.innerText()).toMatch(/\d+\.\d Mbps/);
    await expect.poll(() => stats.innerText()).toMatch(/\d+ ms 延迟/);
    await expect(stats).toContainText('丢包');
    const lines = (await stats.innerText()).split('\n');
    // Negotiated H.264/H.265 adds a codec and acceleration row below the nine connection metrics.
    const pipeline = lines.at(-1)?.includes('H264') || lines.at(-1)?.includes('H265');
    expect(lines).toHaveLength(pipeline ? 10 : 9);
    const text = (await stats.locator('span').boundingBox())!;
    const close = (await stats.getByRole('button', { name: '关闭连接状态' }).boundingBox())!;
    expect(close.x).toBeGreaterThanOrEqual(text.x + text.width - 1);
    await page.screenshot({ path: info.outputPath('connection-stats.png') });
    await stats.getByRole('button', { name: '关闭连接状态' }).click();
    await expect(stats).toHaveCount(0); await expect(page.locator('video')).toBeVisible();
    await page.getByRole('button', { name: '显示', exact: true }).click();
    await page.getByRole('switch', { name: '连接状态' }).click();
    await page.getByRole('button', { name: '关闭显示设置', exact: true }).click();
    await expect(stats).toBeVisible();
  });

test('pinches and pans outside the mouse panel without sending mouse input, then resets on rotation',
  async ({ page }, info) => {
    await openDesktop(page);
    const touch = await touchDriver(page);
    const stage = (await page.locator('.rd-stage').boundingBox())!;
    const original = (await page.locator('video').boundingBox())!;
    const y = stage.y + stage.height / 4;
    const pair = (left: number, right: number): Touch[] => [
      { id: 1, x: stage.x + stage.width * left, y }, { id: 2, x: stage.x + stage.width * right, y },
    ];
    await touch('touchStart', pair(0.2, 0.4));
    await touch('touchMove', pair(0.1, 0.5));
    await expect.poll(async () => (await page.locator('video').boundingBox())!.width / original.width).toBeCloseTo(2);
    const enlarged = (await page.locator('video').boundingBox())!;
    await touch('touchMove', pair(0.15, 0.55));
    const panned = (await page.locator('video').boundingBox())!;
    expect(panned.x - enlarged.x).toBeCloseTo(stage.width * 0.05, 0);
    await touch('touchEnd', [pair(0.15, 0.55)[0]]);
    await touch('touchMove', [pair(0.2, 0.55)[0]]);
    await touch('touchEnd', []);
    expect((await page.locator('video').boundingBox())!).toEqual(panned);
    expect(await page.evaluate(() => window.desktopTest.inputs)).toEqual([]);
    await page.screenshot({ path: info.outputPath('pinch-zoom.png') });
    const finger = { id: 1, x: stage.x + stage.width * 0.75, y: stage.y + stage.height * 0.15 };
    await touch('touchStart', [finger]);
    await touch('touchMove', [{ ...finger, x: finger.x + 12 }]);
    await touch('touchEnd', []);
    expect((await page.locator('video').boundingBox())!).toEqual(panned);
    await page.waitForTimeout(1200); // Include an asynchronous connection-stats update.
    expect((await page.locator('video').boundingBox())!).toEqual(panned);
    const panel = (await page.locator('.rd-mouse-layer').boundingBox())!;
    const cursor = (await page.locator('.rd-cursor').boundingBox())!;
    expect(panel.x - cursor.x).toBeCloseTo(24);
    expect(panel.y).toBeCloseTo(cursor.y);
    await touch('touchStart', pair(0.1, 0.5));
    expect((await page.locator('video').boundingBox())!).toEqual(panned);
    await touch('touchMove', pair(0.29, 0.31));
    await touch('touchEnd', []);
    await expect.poll(async () => (await page.locator('video').boundingBox())!.width).toBeCloseTo(original.width, 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(async () => (await page.locator('video').boundingBox())!.height).toBe(390);
  });

test('keeps mouse panel gestures separate and maps direct touches accurately after zooming', async ({ page }) => {
  await openDesktop(page);
  const touch = await touchDriver(page);
  const original = (await page.locator('video').boundingBox())!;
  const pad = (await page.locator('.rd-pad').boundingBox())!;
  await touch('touchStart', [{ id: 1, x: pad.x + 35, y: pad.y + 40 }, { id: 2, x: pad.x + 65, y: pad.y + 40 }]);
  await touch('touchMove', [{ id: 1, x: pad.x + 20, y: pad.y + 40 }, { id: 2, x: pad.x + 80, y: pad.y + 40 }]);
  await touch('touchEnd', []);
  expect((await page.locator('video').boundingBox())!.width).toBe(original.width);
  await page.getByRole('button', { name: '切换为触屏模式', exact: true }).click();
  const stage = (await page.locator('.rd-stage').boundingBox())!;
  const center = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  const pair = (gap: number): Touch[] => [
    { id: 1, x: center.x - gap, y: center.y }, { id: 2, x: center.x + gap, y: center.y },
  ];
  await touch('touchStart', pair(30));
  await touch('touchMove', pair(60));
  await touch('touchCancel', []);
  await expect.poll(async () => (await page.locator('video').boundingBox())!.width / original.width).toBeCloseTo(2);
  await page.evaluate(() => { window.desktopTest.inputs.length = 0; });
  const video = (await page.locator('video').boundingBox())!;
  await page.mouse.click(center.x - 30, center.y + 20);
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  const move = await page.evaluate(() => window.desktopTest.inputs.find(input => input.kind === 'move'));
  expect(move?.kind).toBe('move');
  if (move?.kind === 'move') {
    expect(move.x).toBeCloseTo((center.x - 30 - video.x) / (video.width - 1), 2);
    expect(move.y).toBeCloseTo((center.y + 20 - video.y) / (video.height - 1), 2);
  }
});

test('keeps text input and its actions inside a short landscape viewport', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openDesktop(page);
  await page.getByRole('button', { name: '键盘', exact: true }).click();
  await page.setViewportSize({ width: 844, height: 140 });
  const input = page.getByRole('textbox', { name: '发送到电脑的文字' });
  await expect(input).toBeVisible(); await expect(page.locator('.rd-stats')).toHaveCount(0);
  const stage = (await page.locator('.rd-stage').boundingBox())!;
  const keyboard = (await page.getByRole('region', { name: '远程输入' }).boundingBox())!;
  expect(keyboard.y).toBeGreaterThanOrEqual(stage.y + stage.height);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  for (const control of [input, page.getByRole('tablist', { name: '输入方式' }),
    page.getByRole('button', { name: '收起键盘', exact: true })]) {
    const bounds = (await control.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(keyboard.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewportHeight);
  }
  await input.fill('compact keyboard');
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'text', text: 'compact keyboard' });
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: '收起键盘', exact: true }).click();
  await expect(page.locator('.rd-keyboard')).toHaveCount(0);
  await expect(page.locator('.rd-stats')).toBeVisible();
});
