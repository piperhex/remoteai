import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const generated = readFileSync(new URL('../../native/src/chat/desktop/desktopImeHtml.generated.ts', import.meta.url), 'utf8');
const desktopImeHtml = JSON.parse(generated.split('\n')[1].trim()
  .replace('export const desktopImeHtml = ', '').replace(/;$/, ''));

async function openDesktop(page: Page, query = '') {
  await page.goto(`e2e/remote-desktop-harness.html?touch&${query}`);
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '键盘', exact: true }).click();
}

async function compose(field: Locator, text: string) {
  await field.evaluate((element, text) => {
    const input = element as HTMLTextAreaElement;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = 'ni';
    input.dispatchEvent(new InputEvent('input', { data: 'ni', isComposing: true, bubbles: true }));
    input.value = text;
    input.dispatchEvent(new CompositionEvent('compositionend', { data: text, bubbles: true }));
    input.value = text;
    input.dispatchEvent(new InputEvent('input', { data: text, inputType: 'insertFromComposition', bubbles: true }));
  }, text);
}

test('commits Chinese once and forwards text, backspace and enter immediately', async ({ page }) => {
  await openDesktop(page);
  const field = page.getByRole('textbox', { name: '发送到电脑的文字' });
  await compose(field, '你好'); await compose(field, '你好');
  await field.fill('hello');
  await field.press('Backspace'); await field.press('Enter');
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs)).toEqual([
    { kind: 'text', text: '你好' }, { kind: 'text', text: '你好' }, { kind: 'text', text: 'hello' },
    { kind: 'key', key: 'backspace' }, { kind: 'key', key: 'enter' },
  ]);
  await expect(field).toHaveValue('');
});

test('uses the same composition handling in the bundled native input document', async ({ page }) => {
  await page.goto('e2e/remote-desktop-harness.html');
  await page.evaluate(() => {
    window.desktopTest.inputs.length = 0;
    Object.assign(window, { ReactNativeWebView: { postMessage: (data: string) => {
      window.desktopTest.inputs.push(JSON.parse(data));
    } } });
  });
  await page.setContent(desktopImeHtml);
  const field = page.getByRole('textbox', { name: '发送到电脑的文字' });
  await compose(field, '你好'); await field.fill('abc'); await field.press('Enter');
  expect(await page.evaluate(() => window.desktopTest.inputs)).toEqual([
    { kind: 'text', text: '你好' }, { kind: 'text', text: 'abc' }, { kind: 'key', key: 'enter' },
  ]);
});

test('docks shortcuts and computer keys below the video and releases complete chords', async ({ page }, info) => {
  await openDesktop(page);
  await page.getByRole('tab', { name: '快捷键', exact: true }).click();
  const keyboard = (await page.locator('.rd-keyboard').boundingBox())!;
  const root = (await page.locator('.rd-root').boundingBox())!;
  const stage = (await page.locator('.rd-stage').boundingBox())!;
  expect(keyboard.width).toBe(root.width);
  expect(keyboard.y).toBeGreaterThanOrEqual(stage.y + stage.height);
  expect(stage.height).toBeGreaterThan(60);
  await page.getByRole('button', { name: 'Ctrl+C 复制', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs)).toEqual([
    { kind: 'keyboard', code: 'ControlLeft', down: true }, { kind: 'keyboard', code: 'KeyC', down: true },
    { kind: 'keyboard', code: 'KeyC', down: false }, { kind: 'keyboard', code: 'ControlLeft', down: false },
  ]);
  await page.screenshot({ path: info.outputPath('input-shortcuts.png') });
  await page.getByRole('tab', { name: '电脑键盘', exact: true }).click();
  await page.getByRole('checkbox', { name: '组合键模式' }).check();
  await page.getByRole('button', { name: 'Ctrl', exact: true }).click();
  await page.getByRole('button', { name: 'Shift', exact: true }).click();
  // Selecting modifiers is local; the entire chord is sent with the final key.
  expect(await page.evaluate(() => window.desktopTest.inputs.length)).toBe(4);
  await page.screenshot({ path: info.outputPath('input-computer-keys.png') });
  await page.getByRole('button', { name: 'Z', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.slice(4))).toEqual([
    { kind: 'keyboard', code: 'ControlLeft', down: true }, { kind: 'keyboard', code: 'ShiftLeft', down: true },
    { kind: 'keyboard', code: 'KeyZ', down: true }, { kind: 'keyboard', code: 'KeyZ', down: false },
    { kind: 'keyboard', code: 'ShiftLeft', down: false }, { kind: 'keyboard', code: 'ControlLeft', down: false },
  ]);
  await expect(page.getByRole('button', { name: 'Ctrl', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '符号和功能键' }).click();
  await page.getByRole('button', { name: 'F12', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'keyboard', code: 'F12', down: false });
  await page.getByRole('button', { name: '收起键盘' }).click();
  await expect(page.locator('.rd-keyboard')).toHaveCount(0);
  await expect.poll(async () => (await page.locator('.rd-stage').boundingBox())!.height).toBeGreaterThan(stage.height);
});

test('requests landscape on entry and never rotates when input opens, switches or closes', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false });
    Object.assign(screen.orientation, {
      lock: async (mode: string) => { document.documentElement.dataset.locks
        = (document.documentElement.dataset.locks ?? '') + mode + ','; },
      unlock: () => { document.documentElement.dataset.unlocked = 'true'; },
    });
  });
  await openDesktop(page);
  await expect(page.locator('html')).toHaveAttribute('data-locks', 'landscape,');
  for (const tab of ['快捷键', '电脑键盘', '输入法']) await page.getByRole('tab', { name: tab, exact: true }).click();
  await page.getByRole('button', { name: '收起键盘' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-locks', 'landscape,');
  await expect(page.locator('html')).not.toHaveAttribute('data-unlocked');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-unlocked', 'true');
});

test('sends Win+L from both the lock shortcut and computer keyboard combination', async ({ page }) => {
  await openDesktop(page);
  const chord = [
    { kind: 'keyboard', code: 'MetaLeft', down: true }, { kind: 'keyboard', code: 'KeyL', down: true },
    { kind: 'keyboard', code: 'KeyL', down: false }, { kind: 'keyboard', code: 'MetaLeft', down: false },
  ];
  await page.getByRole('tab', { name: '快捷键', exact: true }).click();
  await page.getByRole('button', { name: 'Win+L 锁定屏幕', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs)).toEqual(chord);
  await page.getByRole('tab', { name: '电脑键盘', exact: true }).click();
  await page.getByRole('checkbox', { name: '组合键模式' }).check();
  const windowsKey = page.getByRole('button', { name: 'Win', exact: true });
  await windowsKey.click();
  await expect(windowsKey).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.desktopTest.inputs.length)).toBe(chord.length);
  await page.getByRole('button', { name: 'L', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs)).toEqual([...chord, ...chord]);
  await expect(windowsKey).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'L', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.slice(-2))).toEqual([
    { kind: 'keyboard', code: 'KeyL', down: true }, { kind: 'keyboard', code: 'KeyL', down: false },
  ]);
});

test('explains unavailable keys on old hosts while keeping text input usable', async ({ page }) => {
  await openDesktop(page, 'legacy');
  await page.getByRole('tab', { name: '快捷键', exact: true }).click();
  await expect(page.getByText('更新远程电脑上的应用后，即可使用这些按键。')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ctrl+C 复制', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: '输入法', exact: true }).click();
  await page.getByRole('textbox', { name: '发送到电脑的文字' }).fill('兼容');
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'text', text: '兼容' });
});
