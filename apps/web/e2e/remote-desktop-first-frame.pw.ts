import { expect, test } from '@playwright/test';

declare global { interface Window { desktopFirstFrameFixture: RTCRtpSender[] } }

test('keeps the loading message until the connected peer delivers a picture', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.desktopFirstFrameFixture = [];
    const describe = RTCPeerConnection.prototype.setLocalDescription;
    // Complete real signaling and ICE while withholding video packets from the sender.
    Object.defineProperty(RTCPeerConnection.prototype, 'setLocalDescription', {
      value: async function(this: RTCPeerConnection, description?: RTCLocalSessionDescriptionInit) {
        await Reflect.apply(describe, this, [description]);
        if (this.localDescription?.type !== 'offer') return;
        for (const sender of this.getSenders()) {
          if (sender.track?.kind !== 'video') continue;
          const parameters = sender.getParameters();
          parameters.encodings.forEach(encoding => { encoding.active = false; });
          await sender.setParameters(parameters);
          window.desktopFirstFrameFixture.push(sender);
        }
      },
    });
  });
  await page.goto('e2e/remote-desktop-harness.html?audio=1');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  const loading = page.getByText('正在加载桌面画面…', { exact: true });
  await expect(loading).toBeVisible();
  expect(await page.locator('video').evaluate(video => video.videoWidth)).toBe(0);
  // Audio can load before the first video frame; that event must not dismiss picture loading.
  await page.locator('video').dispatchEvent('loadeddata');
  await expect(loading).toBeVisible();
  expect(await loading.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('waiting-for-first-frame.png') });
  await page.evaluate(async () => {
    for (const sender of window.desktopFirstFrameFixture) {
      const parameters = sender.getParameters();
      parameters.encodings.forEach(encoding => { encoding.active = true; });
      await sender.setParameters(parameters);
    }
  });
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(loading).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('first-frame-visible.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
});
