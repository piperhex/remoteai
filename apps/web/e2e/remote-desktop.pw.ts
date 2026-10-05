import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';
const MOUSE_IDLE_DELAY = 10_000;
// Exercise the touch controls here; physical PC input has its own browser regression suite.
test.use({ isMobile: true, hasTouch: true });

declare global { interface Window { desktopTest: typeof desktopTest } }

async function expectAnchoredMouse(page: Page) {
  const cursor = (await page.locator('.rd-cursor').boundingBox())!;
  const panel = (await page.locator('.rd-mouse-layer').boundingBox())!;
  expect(cursor.width).toBe(18); expect(cursor.height).toBe(24);
  expect(panel.x - cursor.x).toBeCloseTo(24); expect(panel.y).toBeCloseTo(cursor.y);
  const stage = (await page.locator('.rd-stage').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(stage.x);
  expect(panel.y).toBeGreaterThanOrEqual(stage.y);
  expect(panel.x + panel.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(panel.y + panel.height).toBeLessThanOrEqual(stage.y + stage.height);
}


test.beforeEach(async ({ page }) => {
  if (!process.env.DESKTOP_RELAY_TEST_ICE) return;
  await page.addInitScript(configuration => { window.desktopRelayFixture = configuration; },
    { iceServers: JSON.parse(process.env.DESKTOP_RELAY_TEST_ICE) });
});

test.afterEach(async ({ page }, info) => {
  if (!process.env.DESKTOP_RELAY_TEST_ICE || info.status === info.expectedStatus) return;
  console.log(await page.evaluate(async () => ({ errors: window.desktopTest.iceErrors,
    peers: await Promise.all(window.desktopTest.peers.map(async peer => ({
      state: peer.connectionState, gathering: peer.iceGatheringState,
      candidates: [...(await peer.getStats()).values()].filter(report => report.type.includes('candidate')),
    }))),
  })));
});

test('streams video, controls mouse and keyboard, applies display settings and closes capture', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '远程桌面' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect.poll(() => page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames))
    .toBeGreaterThan(5);
  await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
  if (process.env.DESKTOP_RELAY_TEST_ICE) {
    const routes = await page.evaluate(async () => Promise.all(window.desktopTest.peers.map(async peer => {
      const reports = await peer.getStats();
      const selected = [...reports.values()].find(report => report.type === 'candidate-pair'
        && report.state === 'succeeded' && report.nominated);
      return selected ? reports.get(selected.localCandidateId) : undefined;
    })));
    expect(routes).toHaveLength(2);
    for (const route of routes) {
      expect(route?.candidateType).toBe('relay');
      expect(route?.relayProtocol).toBe(process.env.DESKTOP_RELAY_TEST_PROTOCOL);
    }
    const beforeRefresh = await page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames);
    // The coturn fixture refreshes allocations every five seconds; credentials expire after twelve seconds.
    await page.waitForTimeout(15_000);
    await expect.poll(() => page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames))
      .toBeGreaterThan(beforeRefresh + 20);
  }
  const collapsed = page.getByRole('button', { name: '展开鼠标面板' });
  if (await collapsed.isVisible()) await collapsed.click();
  await page.getByRole('button', { name: '鼠标左键', exact: true }).click();
  await page.getByRole('button', { name: '鼠标右键', exact: true }).click();
  const wheel = (await page.getByRole('button', { name: '按住并拖动以滚动' }).boundingBox())!;
  await page.mouse.move(wheel.x + wheel.width / 2, wheel.y + wheel.height / 2); await page.mouse.down();
  await page.mouse.move(wheel.x + wheel.width / 2, wheel.y + wheel.height / 2 + 60); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.length)).toBe(8);
  expect(await page.evaluate(() => window.desktopTest.inputs)).toEqual([
    { kind: 'move', x: 0.5, y: 0.5 },
    { kind: 'button', button: 'left', down: true }, { kind: 'button', button: 'left', down: false },
    { kind: 'move', x: 0.5, y: 0.5 },
    { kind: 'button', button: 'right', down: true }, { kind: 'button', button: 'right', down: false },
    { kind: 'move', x: 0.5, y: 0.5 }, { kind: 'wheel', delta: -120 },
  ]);
  await page.screenshot({ path: info.outputPath('remote-desktop-mouse.png') });
  const left = await page.getByRole('button', { name: '鼠标左键', exact: true }).boundingBox();
  await page.mouse.move(left!.x + left!.width / 2, left!.y + left!.height / 2);
  await page.mouse.down();
  await expect(page.getByText('拖拽中', { exact: true })).toBeVisible();
  await page.mouse.up();
  const pad = await page.locator('.rd-pad').boundingBox();
  await page.mouse.move(pad!.x + 20, pad!.y + 35); await page.mouse.down();
  await page.mouse.move(pad!.x + 55, pad!.y + 50); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)?.kind)).toBe('move');
  await page.getByRole('button', { name: '鼠标左键', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  await page.getByRole('button', { name: '显示', exact: true }).click();
  await expect(page.getByRole('group', { name: '帧率', exact: true }).getByRole('button', { name: '自动' }))
    .toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('spinbutton', { name: '自定义帧率' }).fill('45');
  await page.getByRole('button', { name: '应用帧率' }).click();
  await page.getByRole('button', { name: '高清', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.settings.at(-1)))
    .toEqual({ fps: 45, quality: 'clear' });
  const panelWidth = await page.getByRole('complementary', { name: '显示设置' }).evaluate(node => node.clientWidth);
  expect(panelWidth).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('remote-desktop-display.png') });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '键盘', exact: true }).click();
  await page.getByRole('textbox', { name: '发送到电脑的文字' }).fill('你好，远程桌面');
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'text', text: '你好，远程桌面' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
  expect(await page.evaluate(() => window.desktopTest.maxConcurrent)).toBe(1);
  expect(errors).toEqual([]);
});

test('follows the local pointer, collapses when idle and maps direct touches through the video', async ({ page }, info) => {
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
  const stage = (await page.locator('.rd-stage').boundingBox())!;
  const cursor = (await page.locator('.rd-cursor').boundingBox())!;
  const beforeVideo = (await page.locator('video').boundingBox())!;
  const beforePanel = (await page.locator('.rd-mouse').boundingBox())!;
  expect(beforePanel.width).toBe(120); expect(beforePanel.height).toBe(136);
  await expectAnchoredMouse(page);
  await page.mouse.move(stage.x + 15, stage.y + 20); await page.mouse.down();
  await page.mouse.move(stage.x + 45, stage.y + 45); await page.mouse.up();
  const moved = (await page.locator('.rd-cursor').boundingBox())!;
  const movedVideo = (await page.locator('video').boundingBox())!;
  expect(moved.x - cursor.x).toBeCloseTo(30 + movedVideo.x - beforeVideo.x, 0);
  expect(moved.y - cursor.y).toBeCloseTo(25 + movedVideo.y - beforeVideo.y, 0);
  const movedPanel = (await page.locator('.rd-mouse').boundingBox())!;
  expect(movedPanel.x !== beforePanel.x || movedPanel.y !== beforePanel.y).toBe(true);
  await expectAnchoredMouse(page);
  const grip = (await page.getByRole('button', { name: '拖动鼠标面板' }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 15, grip.y + grip.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  await expectAnchoredMouse(page);
  const dragged = (await page.locator('.rd-cursor').boundingBox())!;
  const draggedVideo = (await page.locator('video').boundingBox())!;
  expect(dragged.x - moved.x).toBeCloseTo(15 + draggedVideo.x - movedVideo.x, 0);
  expect(dragged.y - moved.y).toBeCloseTo(10 + draggedVideo.y - movedVideo.y, 0);
  await page.mouse.move(stage.x + 15, stage.y + 20); await page.mouse.down();
  await page.mouse.move(stage.x + 15, stage.y + stage.height - 10); await page.mouse.up();
  const edgePanel = (await page.locator('.rd-mouse').boundingBox())!;
  await expectAnchoredMouse(page);
  const videoHeight = Math.min(stage.height, stage.width * 9 / 16);
  const edgeVideo = (await page.locator('video').boundingBox())!;
  expect(edgePanel.y + edgePanel.height).toBeGreaterThan(edgeVideo.y + edgeVideo.height);
  if (stage.height - videoHeight < 20) expect(edgeVideo.y).toBeLessThan(beforeVideo.y);
  await page.screenshot({ path: info.outputPath('mouse-follows-at-edge.png') });
  const icon = page.getByRole('button', { name: '展开鼠标面板' });
  await expect(icon).toBeVisible({ timeout: MOUSE_IDLE_DELAY + 2500 });
  await expect(page.locator('.rd-cursor')).toHaveCount(0);
  const collapsed = (await icon.boundingBox())!;
  expect(collapsed.x).toBeCloseTo(edgePanel.x); expect(collapsed.y).toBeCloseTo(edgePanel.y);
  expect((await page.locator('video').boundingBox())!).toEqual(edgeVideo);
  await expect(page.locator('.rd-mouse')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('mouse-idle-icon.png') });
  await icon.click(); await expect(page.locator('.rd-mouse')).toBeVisible();
  await expectAnchoredMouse(page);
  const left = (await page.getByRole('button', { name: '鼠标左键', exact: true }).boundingBox())!;
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2); await page.mouse.down();
  await expect(page.getByText('拖拽中', { exact: true })).toBeVisible(); await page.mouse.up();
  await page.waitForTimeout(MOUSE_IDLE_DELAY + 200); await expect(page.locator('.rd-mouse')).toBeVisible();
  const mode = page.locator('.rd-toolbar .rd-mode');
  await expect(mode).toHaveCount(1); await expect(mode).toHaveText('鼠标');
  await page.getByRole('button', { name: '切换为触屏模式', exact: true }).click();
  await expect(mode).toHaveText('触屏');
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  await expect(page.locator('.rd-mouse-layer')).toHaveCount(0);
  await page.evaluate(() => { window.desktopTest.inputs.length = 0; });
  const directVideo = (await page.locator('video').boundingBox())!;
  const { width, height, x: leftEdge, y: topEdge } = directVideo;
  await page.mouse.click(leftEdge + (width - 1) * 0.25, topEdge + (height - 1) * 0.7);
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  const inputs = await page.evaluate(() => window.desktopTest.inputs);
  const move = inputs.find(input => input.kind === 'move');
  expect(move?.kind).toBe('move');
  if (move?.kind === 'move') { expect(move.x).toBeCloseTo(0.25, 2); expect(move.y).toBeCloseTo(0.7, 2); }
  expect(inputs.filter(input => input.kind === 'button')).toEqual([
    { kind: 'button', button: 'left', down: true }, { kind: 'button', button: 'left', down: false },
  ]);
  const count = inputs.length;
  if (leftEdge > stage.x + 2 || topEdge > stage.y + 2) {
    await page.mouse.click(stage.x + 2, stage.y + 2);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.desktopTest.inputs.length)).toBe(count);
  }
  await page.screenshot({ path: info.outputPath('direct-touch.png') });
  await page.getByRole('button', { name: '切换为鼠标模式', exact: true }).click();
  await expect(mode).toHaveText('鼠标');
  await expect(page.locator('.rd-mouse')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
});

test('keeps the complete bottom panel usable while opening and closing the black margin', async ({ page }, info) => {
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
  const stage = (await page.locator('.rd-stage').boundingBox())!;
  const video = (await page.locator('video').boundingBox())!;
  const cursor = (await page.locator('.rd-cursor').boundingBox())!;
  const bottom = stage.y + stage.height - 8 - 136;
  const margin = video.y + video.height - 1 - bottom;
  const swipeDown = async (distance: number) => {
    await page.mouse.move(stage.x + 10, stage.y + 10); await page.mouse.down();
    await page.mouse.move(stage.x + 10, stage.y + 10 + distance, { steps: 5 }); await page.mouse.up();
  };
  if (margin > 0) {
    await swipeDown(bottom - cursor.y);
    expect((await page.locator('video').boundingBox())!.y).toBeCloseTo(video.y, 0);
    const distance = Math.min(16, margin / 4);
    const edgePanel = (await page.locator('.rd-mouse-layer').boundingBox())!;
    await swipeDown(distance);
    await expect.poll(async () => video.y - (await page.locator('video').boundingBox())!.y)
      .toBeCloseTo(distance * 2, 0);
    await expectAnchoredMouse(page);
    const openedY = (await page.locator('video').boundingBox())!.y;
    const openedPanel = (await page.locator('.rd-mouse-layer').boundingBox())!;
    expect(openedPanel.y).toBeCloseTo(edgePanel.y, 0);
    await swipeDown(-distance / 2);
    await expect.poll(async () => (await page.locator('video').boundingBox())!.y - openedY)
      .toBeCloseTo(distance / 2, 0);
    expect(openedPanel.y - (await page.locator('.rd-mouse-layer').boundingBox())!.y)
      .toBeCloseTo(distance / 2, 0);
    await expectAnchoredMouse(page);
    await swipeDown(video.height);
    expect(video.y - (await page.locator('video').boundingBox())!.y).toBeCloseTo(margin, 0);
    const panel = (await page.locator('.rd-mouse-layer').boundingBox())!;
    expect(panel.y + panel.height).toBeCloseTo(stage.y + stage.height - 8, 0);
    await expectAnchoredMouse(page);
    await page.screenshot({ path: info.outputPath('mouse-bottom-edge.png') });
    await page.evaluate(() => { window.desktopTest.inputs.length = 0; });
    await page.locator('.rd-pad').click();
    await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
      .toEqual({ kind: 'button', button: 'left', down: false });
    const target = await page.evaluate(() => window.desktopTest.inputs.find(input => input.kind === 'move'));
    expect(target).toMatchObject({ kind: 'move', y: 1 });
    const cappedY = (await page.locator('video').boundingBox())!.y;
    await page.mouse.move(stage.x + 10, stage.y + stage.height - 10); await page.mouse.down();
    await page.mouse.move(stage.x + 10, stage.y + stage.height - 10 - margin - 20, { steps: 10 });
    await page.mouse.up();
    expect((await page.locator('video').boundingBox())!.y).toBeGreaterThan(cappedY);
    expect((await page.locator('video').boundingBox())!.y).toBeCloseTo(video.y, 0);
  } else {
    await swipeDown(video.height);
    expect((await page.locator('video').boundingBox())!.y).toBeCloseTo(video.y, 0);
  }
  await expectAnchoredMouse(page);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
});

test('keeps the complete right panel usable while panning only after reaching the right edge',
  async ({ page }, info) => {
    await page.goto('e2e/remote-desktop-harness.html');
    await page.getByRole('button', { name: '打开工具' }).click();
    await page.getByRole('button', { name: '远程桌面', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
    await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
    const stage = (await page.locator('.rd-stage').boundingBox())!;
    const video = (await page.locator('video').boundingBox())!;
    const cursor = (await page.locator('.rd-cursor').boundingBox())!;
    const right = stage.x + stage.width - 8 - 24 - 120;
    const swipe = async (distance: number) => {
      await page.mouse.move(stage.x + stage.width / 2, stage.y + 10); await page.mouse.down();
      await page.mouse.move(stage.x + stage.width / 2 + distance, stage.y + 10, { steps: 5 });
      await page.mouse.up();
    };
    await swipe(right - cursor.x);
    expect((await page.locator('video').boundingBox())!.x).toBeCloseTo(video.x, 0);
    const edge = (await page.locator('.rd-mouse-layer').boundingBox())!;
    await swipe(16);
    const moved = (await page.locator('.rd-mouse-layer').boundingBox())!;
    const panned = (await page.locator('video').boundingBox())!;
    expect(moved.x).toBeCloseTo(edge.x, 0);
    expect(video.x - panned.x).toBeCloseTo(16, 0);
    await expectAnchoredMouse(page);
    await page.screenshot({ path: info.outputPath('mouse-right-edge.png') });
    await swipe(-8);
    const returned = (await page.locator('.rd-mouse-layer').boundingBox())!;
    expect(moved.x - returned.x).toBeCloseTo(8, 0);
    expect((await page.locator('video').boundingBox())!.x - panned.x).toBeCloseTo(8, 0);
    await expectAnchoredMouse(page);
    await swipe(video.width);
    const panel = (await page.locator('.rd-mouse-layer').boundingBox())!;
    expect(panel.x + panel.width).toBeCloseTo(stage.x + stage.width - 8, 0);
    await expectAnchoredMouse(page);
    await page.evaluate(() => { window.desktopTest.inputs.length = 0; });
    await page.getByRole('button', { name: '鼠标右键', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
      .toEqual({ kind: 'button', button: 'right', down: false });
    const target = await page.evaluate(() => window.desktopTest.inputs.find(input => input.kind === 'move'));
    expect(target).toMatchObject({ kind: 'move', x: 1 });
    await page.screenshot({ path: info.outputPath('mouse-right-limit.png') });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  });
