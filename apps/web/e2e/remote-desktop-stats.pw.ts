import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window {
  desktopTest: typeof desktopTest;
  desktopStatsFixture: { missing: boolean; channel?: RTCDataChannel };
} }

async function injectMissingStats(page: Page) {
  await page.addInitScript(() => {
    window.desktopStatsFixture = { missing: true };
    // Some clients cannot sample RTC stats; exercise host payloads without local measurements overwriting them.
    RTCPeerConnection.prototype.getStats = async () => new Map() as RTCStatsReport;
    const send = RTCDataChannel.prototype.send;
    Object.defineProperty(RTCDataChannel.prototype, 'send', { value: function(this: RTCDataChannel, data: unknown) {
      if (typeof data === 'string') {
        const message: Record<string, unknown> = JSON.parse(data);
        if (message.kind === 'stats') {
          window.desktopStatsFixture.channel = this;
          const missing = window.desktopStatsFixture.missing;
          data = JSON.stringify({ ...message, rttMs: missing ? null : 24, decodeMs: missing ? null : 3,
            captureMethod: 'DXGI', videoCodec: 'h265', hardwareEncoding: true, hardwareDecoding: true,
            lossPercent: missing ? null : 0, receivedFps: missing ? null : 30,
            receivedBitrate: missing ? null : 2_000_000 });
        }
      }
      return Reflect.apply(send, this, [data]);
    } });
  });
}

test('keeps video and controls usable through null stats and automatic reconnection', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await injectMissingStats(page);
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  const video = page.locator('video');
  const stats = page.getByLabel('连接状态', { exact: true });
  await expect.poll(() => video.evaluate(element => element.videoWidth)).toBeGreaterThan(0);
  await expect(stats).toContainText(/[1-9]\d* × [1-9]\d*/);
  await expect(stats).toContainText('— ms 延迟');
  await expect(stats).toContainText('— Mbps');
  await expect(stats).toContainText(/DXGI · H265$/);
  expect(await stats.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(400);
  const frames = await video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames);
  await expect.poll(() => video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames))
    .toBeGreaterThan(frames + 5);
  await page.evaluate(() => window.desktopStatsFixture.channel!.close());
  await expect.poll(() => page.evaluate(() => window.desktopTest.captures), { timeout: 15_000 }).toBe(2);
  await expect.poll(() => video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames))
    .toBeGreaterThan(5);
  await expect(stats).toContainText(/[1-9]\d* × [1-9]\d*/);
  await expect(stats).toContainText('— ms 延迟');
  await page.screenshot({ path: info.outputPath('reconnected-missing-stats.png') });
  await page.evaluate(() => { window.desktopStatsFixture.missing = false; });
  await expect(stats).toContainText('24 ms 延迟');
  await expect(stats).toContainText('2.0 Mbps');
  await page.getByRole('button', { name: '显示桌面', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.length)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '关闭连接状态' }).click();
  await expect(stats).not.toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '远程桌面' })).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(2);
  expect(errors).toEqual([]);
});
