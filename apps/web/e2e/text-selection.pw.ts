import { expect, test, type Locator, type Page } from '@playwright/test';

const message = 'Long press this message to select words. Quick taps should keep reading comfortable.';

test.beforeEach(async ({ page }) => {
  await page.route('**/display-fixture.json', route => route.fulfill({ json: {
    id: 'selection', cwd: '', preview: '', updatedAt: 1, turns: [{ id: 'turn', status: 'completed', items: [
      { id: 'question', type: 'userMessage', text: 'Select this user message with a long press.' },
      { id: 'answer', type: 'agentMessage', text: `${message}\n\n**Formatted** text and \`inline code\`.` },
    ] }],
  } }));
  await page.goto('e2e/chat-display-harness.html');
  await expect(page.locator('.chat-assistant-message')).toContainText(message);
});

async function touch(target: Locator, action: 'start' | 'move' | 'end' | 'cancel', x = 20, count = 1) {
  await target.evaluate((node, input) => {
    // Desktop WebKit has no constructible Touch; use the same event fields consumed by the browser handler.
    const touches = Array.from({ length: input.count }, (_, identifier) =>
      ({ identifier, target: node, clientX: input.x, clientY: 20 }));
    const event = new Event(`touch${input.action}`, { bubbles: true });
    Object.defineProperty(event, 'touches', {
      value: input.action === 'end' || input.action === 'cancel' ? [] : touches,
    });
    node.dispatchEvent(event);
  }, { action, x, count });
}

async function canSelect(target: Locator) {
  return target.evaluate(node => node.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })));
}

test('touch selection requires a hold and cancels on scrolling, multitouch or interruption', async ({ page }) => {
  for (const selector of ['.chat-user-message .chat-markdown', '.chat-assistant-message .chat-markdown']) {
    const text = page.locator(selector);
    await touch(text, 'start');
    expect(await canSelect(text)).toBe(false);
    await touch(text, 'end');
    await touch(text, 'start');
    expect(await canSelect(text)).toBe(false);
    await touch(text, 'end');
    expect(await canSelect(text)).toBe(false);

    await touch(text, 'start');
    await page.waitForTimeout(550);
    expect(await canSelect(text)).toBe(true);
    await touch(text, 'end');
    expect(await canSelect(text)).toBe(true);

    for (const action of ['move', 'cancel', 'multitouch'] as const) {
      await touch(text, 'start');
      if (action === 'multitouch') await touch(text, 'start', 20, 2);
      else await touch(text, action, 80);
      await page.waitForTimeout(550);
      expect(await canSelect(text)).toBe(false);
      await touch(text, 'end');
    }
  }
});

test('existing selection remains adjustable and mouse and keyboard selection stay available', async ({ page }) => {
  const text = page.locator('.chat-assistant-message .chat-markdown p').first();
  await text.evaluate(node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    window.getSelection()!.addRange(range);
  });
  await touch(text, 'start');
  expect(await canSelect(text)).toBe(true);
  await touch(text, 'end');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await touch(text, 'start');
  await touch(text, 'end');
  await page.keyboard.press('Shift');
  expect(await canSelect(text)).toBe(true);
  await touch(text, 'start');
  await touch(text, 'end');
  await text.dblclick();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).not.toBe('');
});

async function textPoint(page: Page) {
  return page.locator('.chat-assistant-message .chat-markdown p').first().evaluate(node => {
    const range = document.createRange();
    range.setStart(node.firstChild!, 5);
    range.setEnd(node.firstChild!, 10);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
}

test('Chromium touch only permits native selection after a long press', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium' || !info.project.use.hasTouch, 'Native touch needs mobile Chromium.');
  const input = await page.context().newCDPSession(page);
  const point = await textPoint(page);
  const attempts: boolean[] = [];
  await page.exposeFunction('selectionAttempt', (allowed: boolean) => attempts.push(allowed));
  await page.evaluate(() => document.addEventListener('selectstart', event => {
    // Headless desktop Chromium emits selection requests for touch without Android's selection toolbar.
    void (window as unknown as { selectionAttempt: (allowed: boolean) => Promise<void> })
      .selectionAttempt(!event.defaultPrevented);
  }));
  const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? '');
  for (let tap = 0; tap < 3; tap++) {
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  expect(await selected()).toBe('');
  expect(attempts.length).toBeGreaterThan(0);
  expect(attempts.every(allowed => !allowed)).toBe(true);
  attempts.length = 0;
  await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(800);
  await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => attempts.includes(true)).toBe(true);
  await input.detach();
});
