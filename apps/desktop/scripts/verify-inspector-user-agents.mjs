import { expect } from '@playwright/test';

// Verify the headers received by the site independently of the page's navigator object.
export function userAgentFixture(request, response) {
  const headers = request.headers;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    ua: headers['user-agent'], platform: headers['sec-ch-ua-platform'] ?? null,
    mobile: headers['sec-ch-ua-mobile'] ?? null, model: headers['sec-ch-ua-model'] ?? null,
  }));
}

const safariPhone = /\(iPhone; CPU iPhone OS .* Mobile\/\S+ Safari\//;
const presets = [
  ['iPhone 16', safariPhone], ['iPhone SE', safariPhone], ['iPhone 16 Pro Max', safariPhone],
  ['iPad Mini', /\(iPad; CPU OS .* Mobile\/\S+ Safari\//], ['iPad Pro 13', /\(Macintosh;.*Version\/[\d.]+ Safari\//],
  ['Pixel 9', /Android 14; Pixel 9\)/, 'Pixel 9'], ['Pixel 10', /Android 16; Pixel 10\)/, 'Pixel 10'],
  ['Pixel 9 Pro', /Android 14; Pixel 9 Pro\)/, 'Pixel 9 Pro'],
  ['Samsung Galaxy A55', /Android 14; SM-A556B\)/, 'SM-A556B'],
  ['Pixel 9 Pro Fold', /Android 14; Pixel 9 Pro Fold\)/, 'Pixel 9 Pro Fold'],
  ['Galaxy Z Fold 6', /Android 14; SM-F956U\)/, 'SM-F956U'],
  ['Surface Pro 10', /Windows NT .* Chrome\/[\d.]+ Safari\//, 'Surface Pro 10', 'Windows'],
  ['Nest Hub Max', /Linux aarch64.* CrKey\//, 'Nest Hub Max', 'Linux'],
  ['responsive', /Android 10; K\)/, ''],
];

function identity(child) {
  return child.evaluate(async () => ({
    headers: await (await fetch('/user-agent', { cache: 'no-store' })).json(), navigator: navigator.userAgent,
  }));
}

export async function verifyUserAgents(page, child) {
  const toggle = page.locator('.browser-inspector-toolbar > button').first();
  const select = page.locator('.browser-device-toolbar select');
  const desktop = await identity(child);
  await toggle.click();
  for (const [name, pattern, model, platform = 'Android'] of presets) {
    await select.selectOption(name);
    await expect.poll(async () => (await identity(child)).headers.ua, { message: name }).toMatch(pattern);
    const { headers, navigator } = await identity(child);
    expect(headers.ua).toEqual(navigator);
    const hints = model === undefined ? { platform: null, mobile: null, model: null } : {
      platform: JSON.stringify(platform), mobile: platform === 'Android' ? '?1' : '?0', model: JSON.stringify(model),
    };
    expect(headers).toMatchObject(hints);
  }
  await select.selectOption('Pixel 9 Pro');
  await expect.poll(async () => (await identity(child)).headers.ua).toContain('Pixel 9 Pro');
  const pixel = await identity(child);
  await page.locator('.browser-device-size button').click();
  expect(await identity(child)).toEqual(pixel);
  const response = await child.goto('http://127.0.0.1:18316/user-agent');
  expect((await response.json()).ua).toBe(pixel.headers.ua);
  await child.goto('http://127.0.0.1:18316/');
  await toggle.click();
  await expect.poll(() => identity(child)).toEqual(desktop);
  await toggle.click();
  await expect.poll(() => identity(child)).toEqual(pixel);
  await page.locator('.browser-inspector-toolbar button').last().click();
  await expect.poll(() => identity(child)).toEqual(desktop);
  console.log('Verified HTTP headers for all presets, Responsive, navigation, rotation, toggle and close.');
}
