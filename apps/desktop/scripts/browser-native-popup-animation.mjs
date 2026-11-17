import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

export async function verifyOpeningRegion({ popup, nativePid, open }) {
  const probe = spawn('powershell.exe', ['-NoProfile', '-File', fileURLToPath(
    new URL('./browser-popup-region-probe.ps1', import.meta.url)), '-ProcessId', String(nativePid)],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '';
  probe.stdout.on('data', chunk => { output += chunk; });
  probe.stderr.on('data', chunk => { error += chunk; });
  const completed = new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.once('exit', code => code === 0 ? resolve() : reject(new Error(`Region probe: ${error}`)));
  });
  let failure;
  void completed.catch(reason => { failure = reason; });
  try {
    await expect.poll(() => { if (failure) throw failure; return output.startsWith('READY'); },
      { timeout: 15_000 }).toBe(true);
    probe.stdin.end('\n');
    await open();
    await completed;
    const expected = await popup.locator('.browser-bookmark-settings-popup').evaluate(element => {
      const rect = element.getBoundingClientRect(), scale = window.devicePixelRatio;
      return { left: rect.left * scale, top: rect.top * scale,
        right: rect.right * scale, bottom: rect.bottom * scale };
    });
    const samples = JSON.parse(output.slice(output.indexOf('\n') + 1));
    const visible = samples.filter(sample => sample.Visible);
    expect(visible.length).toBeGreaterThan(20);
    for (const sample of visible) {
      expect(sample.Left, `clipped left at ${sample.Time}ms`).toBeLessThanOrEqual(expected.left);
      expect(sample.Top, `clipped top at ${sample.Time}ms`).toBeLessThanOrEqual(expected.top);
      expect(sample.Right, `clipped right at ${sample.Time}ms`).toBeGreaterThanOrEqual(expected.right);
      expect(sample.Bottom, `clipped bottom at ${sample.Time}ms`).toBeGreaterThanOrEqual(expected.bottom);
    }
    expect(samples.slice(samples.findIndex(sample => sample.Visible)).every(sample => sample.Visible)).toBe(true);
    console.log(`PASS opening animation: ${visible.length} native region samples; no clipped icons or hide/show`);
  } finally {
    probe.kill();
    await completed.catch(() => {});
  }
}
