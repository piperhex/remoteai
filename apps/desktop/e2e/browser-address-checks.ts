import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

const origin = 'https://address.example.test';
const longPath = '/conversation/' + '12345678-6698-83ec-b600-d8726a31a1b6/'.repeat(8);
const firstUrl = `${origin}${longPath}?view=first#start`;
const nextUrl = `${origin}${longPath}?view=next#heading`;

export async function prepareAddressPages(page: Page) {
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body:
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<main style="padding:24px;font:16px system-ui"><h1>Address preview</h1>'
    + `<a href="${nextUrl}">Next page</a><p><input aria-label="Page draft" value="Keep editing"></p></main>`,
  }));
}

async function expectAddressStart(address: Locator, url: string) {
  await expect(address).toHaveValue(url);
  await expect(address).not.toBeFocused();
  await expect.poll(() => address.evaluate((input: HTMLInputElement) => ({
    scroll: input.scrollLeft, start: input.selectionStart, end: input.selectionEnd,
  }))).toEqual({ scroll: 0, start: 0, end: 0 });
}

export async function verifyAddressDisplay(options: { page: Page; info: TestInfo; label: string; mobile?: boolean }) {
  const { page, info, label, mobile } = options;
  const browser = page.locator('.browser-main-page, .website-preview-browser');
  const address = browser.getByLabel('页面地址', { exact: true });
  const screenshot = (state: string) => page.screenshot({
    path: info.outputPath(`${label}-${state}.png`), animations: 'disabled',
  });
  await expect(browser.locator('.pm-browser-page')).toHaveCount(1);
  const frame = () => browser.locator('.pm-browser-page:visible iframe').contentFrame();
  await address.fill(firstUrl);
  await address.press('Enter');
  await expect(frame().getByRole('heading', { name: 'Address preview' })).toBeVisible();
  await expectAddressStart(address, firstUrl);
  await screenshot('submitted');

  // Editing may scroll to the end; leaving the field must reveal the origin again.
  await address.focus(); await address.press('End');
  await expect.poll(() => address.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(firstUrl.length);
  await address.press('ArrowLeft'); await address.press('X');
  await expect(address).toHaveValue(firstUrl.slice(0, -1) + 'X' + firstUrl.slice(-1));
  await address.press('Backspace');
  await address.press('End');
  await expect.poll(() => address.evaluate((input: HTMLInputElement) => input.scrollLeft)).toBeGreaterThan(0);
  await frame().getByRole('textbox', { name: 'Page draft' }).click();
  await expectAddressStart(address, firstUrl);
  await screenshot('page-editing');

  await address.fill(nextUrl); await address.press('Enter');
  await expectAddressStart(address, nextUrl);
  await screenshot('page-navigation');
  await browser.getByRole('button', { name: '新标签页', exact: true }).click();
  await expect(address).toHaveValue('');
  if (mobile) {
    await browser.getByRole('button', { name: '管理标签页（2）', exact: true }).click();
    await browser.locator('.browser-tab-select').first().click();
  } else await browser.getByRole('tab').first().click();
  await expectAddressStart(address, nextUrl);
  await screenshot('restored-tab');
}
