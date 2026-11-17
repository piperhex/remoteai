import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect as baseExpect } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 10_000 });
const probePath = fileURLToPath(new URL('./browser-context-menu-probe.ps1', import.meta.url));

export function probe(pid, action = 'read', screenshot) {
  const result = execFileSync('powershell', ['-NoProfile', '-File', probePath, '-ProcessId', String(pid),
    '-Action', action, ...(screenshot ? ['-Screenshot', screenshot] : [])],
  { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return result.trim() ? JSON.parse(result) : undefined;
}

async function openMenu(child, gesture, fixture) {
  const point = await child.evaluate(() => ({ x: Math.floor(innerWidth * 0.45), y: Math.floor(innerHeight * 0.4) }));
  await child.evaluate(() => { window.lastContextMenu = null; });
  if (gesture === 'right-click') {
    await child.mouse.click(point.x, point.y, { button: 'right' });
  } else {
    const { pid, geometry } = fixture;
    const x = Math.round(geometry.x + point.x * geometry.scale * geometry.zoom);
    const y = Math.round(geometry.y + point.y * geometry.scale * geometry.zoom);
    execFileSync('powershell', ['-NoProfile', '-File', probePath, '-ProcessId', String(pid),
      '-Action', 'long-press', '-X', String(x), '-Y', String(y)], {windowsHide:true});
  }
  await expect.poll(() => child.evaluate(() => window.lastContextMenu)).not.toBeNull();
  return child.evaluate(() => window.lastContextMenu);
}

async function checkMenu({ main, child, pid, output }, sample) {
  const { scale, zoom, gesture, label } = sample;
  const geometry = await main.evaluate(({scale, zoom}) =>
    window.__TAURI_INTERNALS__.invoke('context_menu_fixture', { scale, zoom }), {scale, zoom});
  await expect.poll(() => child.evaluate(() => devicePixelRatio)).toBeCloseTo(scale * zoom, 1);
  const event = await openMenu(child, gesture, {pid, geometry});
  let native;
  await expect.poll(() => {
    try { native = probe(pid); return true; } catch { return false; }
  }).toBe(true);
  const expected = { x: geometry.x + event.x * scale * zoom, y: geometry.y + event.y * scale * zoom };
  // DOM MouseEvent and WebView2 POINT each quantize to integers in different coordinate spaces.
  const tolerance = Math.ceil(scale * zoom + scale);
  expect(Math.abs(native.menu.Left - expected.x), `${label}: horizontal anchor`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(native.menu.Top - expected.y), `${label}: vertical anchor`).toBeLessThanOrEqual(tolerance);
  probe(pid, 'read', fileURLToPath(new URL(`${label}.png`, output)));
  probe(pid, 'dismiss');
  await expect.poll(() => { try { probe(pid); return false; } catch { return true; } }).toBe(true);
  console.log(`PASS ${label}: menu (${native.menu.Left}, ${native.menu.Top}), anchor (${expected.x}, ${expected.y})`);
  return { ...sample, geometry, event, expected, ...native };
}

export async function verifyContextMenus(fixture) {
  const { main, pid, output } = fixture;
  const results = [];
  for (const mode of ['local', 'remote']) {
    if (mode === 'remote') {
      await main.goto('http://127.0.0.1:1552/e2e/browser-bookmarks-harness.html?mode=remote');
      await main.getByLabel('页面地址', { exact: true }).fill('http://127.0.0.1:18326');
      await main.getByLabel('页面地址', { exact: true }).press('Enter');
      // The caller reconnects to the newly-created native child after navigation.
      fixture.child = await fixture.findChild();
    }
    for (const narrow of [false, true]) {
      await main.evaluate(({width, height}) => window.__TAURI_INTERNALS__.invoke('fixture_size', {width, height}),
        { width: narrow ? 685 : 1200, height: narrow ? 521 : 800 });
      probe(pid, 'prepare');
      for (const [scale, zoom] of [[1, 1], [1.25, 1], [1.5, 0.8], [2, 1.5]]) {
        const label = `windows-${mode}-${narrow ? 'narrow' : 'wide'}-scale${scale}-zoom${zoom}`;
        const mouse = await checkMenu(fixture, { scale, zoom, gesture: 'right-click', label });
        results.push(mouse);
        if (scale === 1.25 && !process.argv.includes('--mouse-only')) {
          const touch = await checkMenu(fixture, { scale, zoom, gesture: 'long-press', label: `${label}-touch` });
          expect(touch.items).toEqual(mouse.items);
          results.push(touch);
        }
      }
    }
  }
  await writeFile(new URL('measurements.json', output), JSON.stringify(results, null, 2));
  return results;
}
