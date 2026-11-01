import { expect, test, type Locator, type Page } from '@playwright/test';
import { dragSheet } from './sheet-drag';

async function point(option: Locator) {
  await option.scrollIntoViewIfNeeded();
  const bounds = await option.boundingBox();
  if (!bounds) throw new Error('Missing setting option');
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function touchDrag(page: Page, from: Locator, to: Locator, cancel = false) {
  const start = await point(from);
  const end = await point(to);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 5; step++) {
      const x = start.x + (end.x - start.x) * step / 5;
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start.y }] });
    }
    await expect(from).toBeChecked();
    await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
  await expect(cancel ? from : to).toBeChecked();
}

test('compact settings support touch dragging, cancellation, clicking and keyboard selection', async ({ page }, info) => {
  await page.goto('e2e/chat-settings-harness.html');
  if (info.project.name === 'mobile') {
    const credits = page.locator('.chat-usage-credits');
    await expect(credits).toHaveText('额度点数 56,879.423');
    await expect(credits).toBeVisible();
    await expect(page.locator('.sheet-header')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
  }
  await page.screenshot({ path: info.outputPath('settings-initial.png'), animations: 'disabled' });
  const effort = page.getByRole('radiogroup', { name: '推理强度' });
  const low = effort.getByRole('radio', { name: '低', exact: true });
  const ultra = effort.getByRole('radio', { name: 'Ultra', exact: true });
  await expect(page.getByRole('radiogroup')).toHaveCount(3);
  await expect(page.getByText('推理强度', { exact: true })).toHaveCount(0);
  await low.click();
  await expect(effort.locator('.chat-setting-segments-thumb')).toHaveCSS('background-color', 'rgb(40, 111, 189)');
  await touchDrag(page, low, ultra, true);
  await touchDrag(page, low, ultra);
  await expect(effort.locator('.chat-setting-segments-thumb')).toHaveCSS('background-color', 'rgb(196, 75, 53)');
  await ultra.focus();
  await page.keyboard.press('Home');
  await expect(low).toBeChecked();
  await page.keyboard.press('End');
  await expect(ultra).toBeChecked();
  const speed = page.getByRole('radiogroup', { name: '速度模式' });
  await touchDrag(page, speed.getByRole('radio', { name: '普通模式', exact: true }),
    speed.getByRole('radio', { name: 'Ultrafast 模式', exact: true }));
  const access = page.getByRole('radiogroup', { name: '访问权限' });
  await touchDrag(page, access.getByRole('radio', { name: '完全访问' }), access.getByRole('radio', { name: '请求批准' }));
  await page.screenshot({ path: info.outputPath('compact-settings.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => document.documentElement.style.setProperty('--app-font-scale', '1.3'));
  for (const group of [effort, speed, access]) {
    expect(await group.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  const context = page.locator('.chat-usage-card-context');
  await context.scrollIntoViewIfNeeded();
  await expect(context.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
  await expect(page.locator('.chat-usage-cost').last()).toContainText('48.83 USD');
  await expect(page.locator('.chat-usage-card')).not.toContainText('预估');
  await expect(page.locator('.chat-usage-credits')).toHaveText('额度点数 56,879.423');
  expect(await context.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('compact-settings-large-font.png'), animations: 'disabled' });
  await access.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('compact-settings-large-font-options.png'), animations: 'disabled' });
  await context.getByRole('button', { name: '对话上下文设置' }).click();
  await expect(page.getByRole('textbox', { name: '上下文容量（K Token）' })).toBeVisible();
  await page.getByRole('button', { name: '返回上一层' }).last().click();
  await expect(context).toBeVisible();
});

test('bottom sheets follow handle drags, rebound and dismiss only the current sheet', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Bottom sheets are the mobile presentation');
  await page.goto('e2e/chat-settings-harness.html');
  const settings = page.locator('.chat-settings');
  const body = page.locator('.mobile-popup').last();
  await expect(settings).toBeVisible();
  await dragSheet(page, 30);
  await expect(body).toHaveCSS('translate', '0px');
  await expect(settings).toBeVisible();
  await dragSheet(page, -50);
  await expect(settings).toBeVisible();
  await dragSheet(page, 120, { cancel: true });
  await expect(body).toHaveCSS('translate', '0px');
  await expect(settings).toBeVisible();
  await page.getByRole('button', { name: '设置模型' }).click();
  await expect(page.getByRole('heading', { name: '选择模型', exact: true })).toBeVisible();
  const list = page.locator('.chat-setting-options');
  await list.evaluate(element => { element.scrollTop = 150; });
  expect(await list.evaluate(element => element.scrollTop)).toBe(150);
  await dragSheet(page, 120, { target: page.getByRole('radio', { name: 'Preview 6', exact: true }), follows: false });
  await expect(page.getByRole('heading', { name: '选择模型', exact: true })).toBeVisible();
  expect(await list.evaluate(element => element.scrollTop)).toBeLessThan(150);
  await list.evaluate(element => { element.scrollTop = 0; });
  await dragSheet(page, 120, { target: page.getByRole('radio', { name: 'GPT-6-Astra', exact: true }) });
  await expect(page.locator('.chat-setting-options')).toHaveCount(0);
  await expect(settings).toBeVisible();
  await page.getByRole('button', { name: '对话上下文设置' }).click();
  await expect(page.getByRole('textbox', { name: '上下文容量（K Token）' })).toBeVisible();
  await dragSheet(page, 120);
  await expect(page.getByRole('textbox', { name: '上下文容量（K Token）' })).toHaveCount(0);
  await expect(settings).toBeVisible();
  await dragSheet(page, 120);
  await expect(settings).toHaveCount(0);
  await page.getByRole('button', { name: '聊天设置', exact: true }).click();
  await expect(settings).toBeVisible();
  await page.locator('.adm-mask').last().click({ position: { x: 10, y: 10 } });
  await expect(settings).toHaveCount(0);
});

test('mobile usage meters retain quota thresholds and context uses the remaining percentage', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Card presentation is mobile only');
  for (const [context, remaining, contextColor, quotaColor] of [
    [155800, 78, 'rgb(53, 173, 167)', 'rgb(53, 173, 167)'],
    [180880, 20, 'rgb(208, 163, 64)', 'rgb(208, 163, 64)'],
    [232560, 5, 'rgb(210, 104, 91)', 'rgb(210, 104, 91)'],
    [258400, 0, 'rgb(210, 104, 91)', 'rgb(210, 104, 91)'],
  ] as const) {
    await page.goto(`e2e/chat-settings-harness.html?context=${context}&remaining=${remaining}`);
    const contextFill = page.locator('.chat-usage-card-context [role="progressbar"] > span');
    const quota = page.locator('.chat-usage-card-quota [role="progressbar"]');
    await expect(contextFill).toHaveCSS('background-color', contextColor);
    await expect(quota).toHaveAttribute('aria-valuenow', String(remaining));
    await expect(quota.locator('span')).toHaveCSS('background-color', quotaColor);
    await page.screenshot({ path: info.outputPath(`meters-${remaining}.png`), animations: 'disabled' });
  }
});

test('mobile cards fit all released languages and dark appearance', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Card presentation is mobile only');
  for (const language of ['zh', 'en', 'ja', 'ru']) {
    await page.goto(`e2e/chat-settings-harness.html?language=${language}`);
    await expect(page.locator('.chat-usage-credits')).toContainText('56');
    await expect(page.locator('.chat-settings-mobile')).not.toContainText('client.chatSettings.');
    for (const selector of ['.chat-usage-card', '.chat-settings-connection', '.chat-setting-segments-row']) {
      for (const element of await page.locator(selector).all()) {
        expect(await element.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
    }
    await page.screenshot({ path: info.outputPath(`settings-${language}.png`), animations: 'disabled' });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('e2e/chat-settings-harness.html');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.chat-usage-card')).toHaveCSS('background-color', 'rgb(18, 22, 20)');
  await page.screenshot({ path: info.outputPath('settings-dark.png'), animations: 'disabled' });
});
