import { expect, test, type Page } from '@playwright/test';

async function selectColumns(page: Page, start: number, end: number) {
  const firstCell = await page.locator('.xterm-rows > div').first().evaluate(row => {
    const character = document.createTreeWalker(row, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(character, 0);
    range.setEnd(character, 1);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  });
  const x = (col: number) => firstCell.x + col * firstCell.width + 1;
  const y = firstCell.y + firstCell.height / 2;
  await page.mouse.move(x(start), y);
  await page.mouse.down();
  await page.mouse.move(x(end), y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.xterm-selection > div').first()).toBeVisible();
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode} terminal right-click copies and clears a selection or pastes once`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/e2e/project-browser-terminal-harness.html?mode=${mode}`);
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await page.getByRole('treeitem', { name: 'src', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '在终端中打开', exact: true }).click();
    const panel = page.getByRole('region', { name: '终端', exact: true });
    const rows = panel.locator('.xterm-rows');
    const prompt = 'PS C:/project/src> ';
    const text = 'echo "你好，终端"';
    await expect(rows).toContainText(prompt.trim());
    await page.evaluate(value => navigator.clipboard.writeText(value), text);
    const screen = panel.locator('.xterm-screen');
    await screen.click({ button: 'right' });
    await expect(rows).toHaveText(prompt + text);
    await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();
    await panel.screenshot({ path: info.outputPath(`${mode}-right-click-paste.png`) });
    const selected = '你好，终端';
    const start = prompt.length + text.indexOf(selected);
    await selectColumns(page, start, start + selected.length * 2);
    await panel.screenshot({ path: info.outputPath(`${mode}-selected.png`) });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
    } }));
    await screen.click({ button: 'right' });
    await expect(panel.getByRole('status')).toHaveText('复制失败，请重试。');
    await panel.screenshot({ path: info.outputPath(`${mode}-copy-denied.png`) });
    await page.evaluate(() => Reflect.deleteProperty(navigator, 'clipboard'));
    await screen.click({ button: 'right' });
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
    await expect(panel.locator('.xterm-selection > div')).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveCount(0);
    await expect(rows).toHaveText(prompt + text);
    await panel.screenshot({ path: info.outputPath(`${mode}-copied.png`) });
    await screen.click({ button: 'right' });
    await expect(rows).toHaveText(prompt + text + selected);
    await panel.getByRole('tab').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '关闭其他标签页' })).toBeVisible();
    await expect(rows).toHaveText(prompt + text + selected);
  });
}

test('clipboard gestures preserve bracketed paste, report unavailable clipboard and respect terminal mouse mode',
  async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/e2e/terminal-harness.html');
    await page.getByRole('button', { name: '切换终端' }).click();
    const screen = page.locator('.xterm-screen');
    const writes = () => page.evaluate(() => window.terminalHarness.snapshot().writes);
    const setMode = (sequence: string) => page.evaluate(value => {
      window.terminalHarness.output(value + '\r\n' + JSON.stringify(value));
    }, sequence);
    await expect(page.locator('.xterm-rows')).toContainText('Windows PowerShell');
    await setMode('\x1b[?2004h');
    await expect(page.locator('.xterm-rows')).toContainText('2004h');
    await page.evaluate(() => navigator.clipboard.writeText('first\nsecond'));
    await screen.click({ button: 'right' });
    const bracketed = '\x1b[200~first\rsecond\x1b[201~';
    await expect.poll(writes).toEqual([bracketed]);
    await page.keyboard.press('Control+Shift+V');
    await expect.poll(writes).toEqual([bracketed, bracketed]);
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await screen.click({ button: 'right' });
    await setMode('\x1b[?1000h\x1b[?1006h');
    await expect(page.locator('.xterm-rows')).toContainText('1006h');
    await page.evaluate(() => navigator.clipboard.writeText('mouse mode'));
    await screen.click({ button: 'right' });
    await expect.poll(async () => (await writes()).slice(2).join('')).toMatch(/^\x1b\[<2;\d+;\d+M\x1b\[<2;\d+;\d+m$/);
    await setMode('\x1b[?1000l');
    await expect(page.locator('.xterm-rows')).toContainText('1000l');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
    await screen.click({ button: 'right' });
    await expect(page.getByRole('status')).toHaveText('无法粘贴，请重试。');
  });

test('a pending clipboard read cannot paste into a hidden terminal', async ({ page }) => {
  await page.goto('/e2e/terminal-harness.html');
  await page.getByRole('button', { name: '切换终端' }).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: {
    readText: () => new Promise<string>(resolve => {
      window.addEventListener('finish-paste', () => resolve('old tab'), { once: true });
      document.body.dataset.readingClipboard = 'true';
    }),
  } }));
  await page.locator('.xterm-screen').click({ button: 'right' });
  await expect(page.locator('body')).toHaveAttribute('data-reading-clipboard', 'true');
  await page.getByRole('button', { name: '新建终端' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.evaluate(() => window.dispatchEvent(new Event('finish-paste')));
  expect(await page.evaluate(() => window.terminalHarness.snapshot().writes)).toEqual([]);
});

test('a delayed copy preserves a newer selection', async ({ page }) => {
  await page.goto('/e2e/terminal-harness.html');
  await page.getByRole('button', { name: '切换终端' }).click();
  await expect(page.locator('.xterm-rows')).toContainText('Windows PowerShell');
  await selectColumns(page, 0, 7);
  const screen = page.locator('.xterm-screen');
  const selection = page.locator('.xterm-selection > div').first();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: {
    writeText: () => new Promise<void>(resolve => {
      window.addEventListener('finish-copy', () => resolve(), { once: true });
      document.body.dataset.copying = 'true';
    }),
  } }));
  await screen.click({ button: 'right' });
  await expect(page.locator('body')).toHaveAttribute('data-copying', 'true');
  await selectColumns(page, 8, 18);
  await page.evaluate(() => window.dispatchEvent(new Event('finish-copy')));
  await expect(selection).toBeVisible();
  expect(await page.evaluate(() => window.terminalHarness.snapshot().writes)).toEqual([]);
});
