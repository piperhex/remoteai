import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect as playwrightExpect } from '@playwright/test';

const expect = playwrightExpect.configure({ timeout: 15_000 });
const run = promisify(execFile);
const probe = fileURLToPath(new URL('./inspector-visibility-probe.ps1', import.meta.url));
const fixture = fileURLToPath(new URL('../../../.codex-tmp/browser-inspector/inspector-smoke.exe', import.meta.url));

async function inspectorWindow() {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-File', probe, '-Fixture', fixture],
    { windowsHide: true });
  return JSON.parse(stdout);
}

const viewport = page => page.evaluate(() => [innerWidth, innerHeight]);

async function expectSize(child, expected) {
  await expect.poll(async () => {
    const [width, height] = await expected();
    const [actualWidth, actualHeight] = await viewport(child);
    return Math.max(Math.abs(width - actualWidth), Math.abs(height - actualHeight));
  }).toBeLessThanOrEqual(1);
}

export async function verifyInspectorFullscreen(page, child) {
  const video = child.locator('video');
  await child.evaluate(src => {
    const player = document.createElement('video');
    player.controls = true; player.muted = true; player.loop = true;
    player.style.cssText = 'display:block;width:100%;max-height:48vh;background:black';
    player.src = src;
    document.querySelector('h1').after(player);
  }, new URL('/e2e/fixtures/video-preview.mp4', page.url()).href);
  try {
    await video.evaluate(player => player.play());
    for (const [index, dock] of ['right', 'bottom'].entries()) {
      const buttons = page.locator('.browser-inspector-toolbar').getByRole('group').getByRole('button');
      await buttons.nth(index).click();
      await expect(page.locator('.browser-inspector-layout:visible')).toHaveAttribute('data-dock', dock);
      const surface = page.locator('.pm-browser-surface:visible');
      const tabSize = async () => {
        const bounds = await surface.boundingBox();
        return [Math.round(bounds.width), Math.round(bounds.height)];
      };
      await expectSize(child, tabSize);
      const original = await inspectorWindow();
      expect(original.visible).toBe(true);
      // WebView2 requires a native user gesture. Exercise its player controls and actual fullscreen notification.
      console.log(`${dock}: enter fullscreen using the video player's fullscreen control.`);
      const fullscreen = () => video.evaluate(player => document.fullscreenElement === player);
      await expect.poll(fullscreen, { timeout: 120_000 }).toBe(true);
      await expectSize(child, () => viewport(page));
      await expect.poll(inspectorWindow).toEqual({ ...original, visible: false });
      console.log(`${dock}: inspector is hidden. Exit fullscreen with the video player's controls.`);
      await expect.poll(fullscreen, { timeout: 120_000 }).toBe(false);
      await expectSize(child, tabSize);
      await expect.poll(inspectorWindow).toEqual(original);
      await expect(buttons.nth(index)).toHaveAttribute('aria-pressed', 'true');
      console.log(`WebView2 ${dock}: inspector HWND ${original.handle} hid and returned to the same dock.`);
    }
  } finally { await video.evaluate(player => player.remove()); }
}
