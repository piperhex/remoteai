import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window {
  desktopTest: typeof desktopTest;
  desktopAdaptationFixture: {
    loss: number; capacity: number; parameters: { fps?: number; bitrate?: number; preference?: string }[];
  };
} }

async function injectNetworkFeedback(page: Page) {
  await page.addInitScript(() => {
    window.desktopAdaptationFixture = { loss: 0, capacity: 32_000_000, parameters: [] };
    const getStats = RTCPeerConnection.prototype.getStats;
    RTCPeerConnection.prototype.getStats = async function() {
      const reports = await getStats.call(this);
      if (!this.getSenders().some(sender => sender.track?.kind === 'video')) return reports;
      // Only network feedback is controlled. Capture, sender parameters, transport and decoding remain real.
      const controlled = new Map<string, Record<string, unknown>>();
      reports.forEach(report => {
        const next = { ...report };
        if (next.type === 'candidate-pair') {
          next.availableOutgoingBitrate = window.desktopAdaptationFixture.capacity; next.currentRoundTripTime = 0.01;
        }
        if (next.type === 'remote-inbound-rtp') next.fractionLost = window.desktopAdaptationFixture.loss;
        if (next.type === 'outbound-rtp') {
          next.qualityLimitationReason = window.desktopAdaptationFixture.capacity < 32_000_000 ? 'bandwidth' : 'none';
        }
        controlled.set(next.id, next);
      });
      controlled.set('network-fixture', { id: 'network-fixture', timestamp: performance.now(),
        type: 'remote-inbound-rtp', kind: 'video',
        fractionLost: window.desktopAdaptationFixture.loss });
      return controlled as RTCStatsReport;
    };
    const setParameters = RTCRtpSender.prototype.setParameters;
    RTCRtpSender.prototype.setParameters = async function(parameters) {
      await setParameters.call(this, parameters);
      window.desktopAdaptationFixture.parameters.push({ fps: parameters.encodings[0]?.maxFramerate,
        bitrate: parameters.encodings[0]?.maxBitrate, preference: parameters.degradationPreference });
    };
  });
}

test('keeps resolution while reducing FPS, then restores clarity before high FPS', async ({ page }, info) => {
  test.setTimeout(90_000);
  await injectNetworkFeedback(page);
  await page.goto('e2e/remote-desktop-harness.html?displays');
  await page.evaluate(() => {
    window.desktopTest.displays[0].width = 2560; window.desktopTest.displays[0].height = 1440;
  });
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  const video = page.locator('video');
  const latest = () => page.evaluate(() => window.desktopAdaptationFixture.parameters.at(-1));
  await expect.poll(latest, { timeout: 15_000 }).toMatchObject({ fps: 60, bitrate: 12_000_000,
    preference: 'maintain-resolution' });
  await expect.poll(() => video.evaluate(video => video.videoWidth)).toBe(2560);
  await page.evaluate(() => { window.desktopAdaptationFixture.loss = 0.1; });
  for (const fps of [50, 40, 30]) {
    await expect.poll(latest, { timeout: 12_000 }).toMatchObject({ fps, bitrate: fps * 200_000 });
    expect(await video.evaluate(video => video.videoWidth)).toBe(2560);
  }
  await expect.poll(() => video.evaluate(video => video.videoWidth), { timeout: 12_000 }).toBe(1920);
  await page.evaluate(() => { window.desktopAdaptationFixture.loss = 0; });
  await expect.poll(latest, { timeout: 10_000 }).toMatchObject({ fps: 30, bitrate: 6_000_000 });
  await expect.poll(() => video.evaluate(video => video.videoWidth)).toBe(2560);
  for (const fps of [40, 50, 60]) {
    await expect.poll(latest, { timeout: 10_000 }).toMatchObject({ fps, bitrate: fps * 200_000 });
  }
  await page.getByRole('button', { name: '显示', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '显示设置' });
  await expect(panel).toContainText('自动模式优先使用最高画质和 60 帧');
  await panel.getByText('自动模式优先使用最高画质和 60 帧', { exact: false }).scrollIntoViewIfNeeded();
  expect(await panel.evaluate(node => node.getBoundingClientRect().width)).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('frame-first-settings.png') });
  await page.getByRole('button', { name: '关闭显示设置', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
  expect(await page.evaluate(() => window.desktopTest.maxConcurrent)).toBe(1);
});

for (const quality of ['auto', 'original'] as const) {
test(`retains ${quality} resolution and bitrate with zero loss and a low bandwidth estimate`, async ({ page }) => {
  await injectNetworkFeedback(page);
  await page.goto('e2e/remote-desktop-harness.html?displays');
  await page.evaluate(() => {
    window.desktopTest.displays[0].width = 2560; window.desktopTest.displays[0].height = 1440;
  });
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await page.getByRole('button', { name: '显示', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '显示设置' });
  await panel.getByRole('button', { name: quality === 'auto' ? '自动' : '超清', exact: true }).first().click();
  await panel.getByRole('button', { name: '60 帧', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.settings.at(-1)?.fps)).toBe(60);
  await expect.poll(() => page.evaluate(() => window.desktopTest.settings.at(-1)?.quality)).toBe(quality);
  await page.getByRole('button', { name: '关闭显示设置', exact: true }).click();
  const start = await page.evaluate(() => {
    window.desktopAdaptationFixture.capacity = 300_000;
    return window.desktopAdaptationFixture.parameters.length;
  });
  await expect.poll(() => page.evaluate(() => window.desktopAdaptationFixture.parameters.length),
    { timeout: 35_000 }).toBeGreaterThanOrEqual(start + 10);
  const samples = await page.evaluate(start => window.desktopAdaptationFixture.parameters.slice(start), start);
  for (const sample of samples) {
    expect(sample).toMatchObject({ fps: 60, bitrate: 12_000_000, preference: 'maintain-resolution' });
  }
  expect(await page.locator('video').evaluate(video => video.videoWidth)).toBe(2560);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
});
}
