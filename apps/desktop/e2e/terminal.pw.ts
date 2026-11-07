import { expect, test, type Page } from "@playwright/test";

interface Snapshot { opens: number; closes: number; writes: string[]; sizes: { cols: number; rows: number }[];
  ticks: number; links: string[]; external: string[] }
declare global {
  interface Window { terminalHarness: { snapshot: () => Snapshot; stream: () => void; output: (text: string) => void } }
}
const snapshot = (page: Page) => page.evaluate(() => window.terminalHarness.snapshot());
async function clickTerminalLink(page: Page, text: string) {
  const link = page.locator('.xterm-rows').getByText(text, { exact: false });
  await expect(link).toBeVisible();
  // xterm renders text with pointer-events:none and handles links on its screen overlay.
  // Recalculate while the details drawer animates and the terminal fits its new width.
  let point = { x: 0, y: 0 };
  await expect.poll(async () => {
    const bounds = await link.evaluate((element, href) => {
      const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let offset = (element.textContent ?? '').indexOf(href) + 10;
      let node: Node | null;
      while ((node = nodes.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (offset >= length) { offset -= length; continue; }
        const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
        return range.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number };
      }
      throw new Error('Terminal link text is not rendered');
    }, text);
    point = { x: bounds.x + bounds.width * 0.65, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(point.x + 20, point.y);
    await page.mouse.move(point.x, point.y, { steps: 8 });
    return page.locator('.xterm-screen').evaluate(element => getComputedStyle(element).cursor);
  }).toBe('pointer');
  await page.mouse.click(point.x, point.y);
}

test("embedded terminal themes, tab lifecycle, resize, input and concurrent chat controls", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/e2e/terminal-harness.html");
  await page.getByRole("button", { name: "切换终端" }).click();
  const panel = page.getByRole("region", { name: "终端", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".xterm-screen")).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).opens).toBe(1);
  await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(panel.locator(".xterm-viewport")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("terminal-light.png") });
  await panel.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo hello"); await page.keyboard.press("Enter");
  await expect.poll(async () => (await snapshot(page)).writes.join("")).toContain("echo hello\r");
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(panel).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(panel.locator(".xterm-viewport")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("terminal-dark.png") });
  await page.getByRole("button", { name: "收起终端", exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "切换终端" }).click();
  expect((await snapshot(page)).opens).toBe(1);
  await page.getByRole("button", { name: "新建终端" }).click();
  await expect(panel.getByRole("tab")).toHaveCount(2);
  await expect.poll(async () => (await snapshot(page)).opens).toBe(2);
  await page.getByRole("button", { name: "关闭终端 2" }).click();
  await expect.poll(async () => (await snapshot(page)).closes).toBe(1);
  const grip = page.getByRole("separator", { name: "调整终端高度" });
  const before = await panel.boundingBox();
  await grip.focus(); await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(before!.height);
  const ticks = (await snapshot(page)).ticks;
  await page.evaluate(() => window.terminalHarness.stream());
  await page.getByRole("textbox", { name: "聊天输入" }).fill("终端运行时仍能输入");
  await page.getByRole("button", { name: "侧栏内容", exact: true }).click();
  await expect(page.getByRole('dialog', { name: '新标签页', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '文件更改', exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "侧栏内容", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "聊天输入" })).toHaveValue("终端运行时仍能输入");
  expect((await snapshot(page)).ticks).toBeGreaterThan(ticks);
  await page.setViewportSize({ width: 640, height: 600 });
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).sizes.length).toBeGreaterThan(0);
  // The backend rejects unknown fields, including xterm's internal resize flags.
  for (const size of (await snapshot(page)).sizes) {
    expect(Object.keys(size).sort()).toEqual(["cols", "rows"]);
  }
  await expect(panel.getByRole("status")).toHaveCount(0);
});

for (const remote of [false, true]) {
  test(`terminal links open in preview and browser on ${remote ? 'remote' : 'local'} computers`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/e2e/terminal-harness.html${remote ? '?remote=1' : ''}`);
    await page.getByRole('button', { name: '切换终端' }).click();
    await expect.poll(async () => (await snapshot(page)).opens).toBe(1);
    const url = remote ? 'http://localhost:3002/' : `${new URL(page.url()).origin}/e2e/terminal-site.html`;
    await page.evaluate(value => window.terminalHarness.output(`\r\nLocal: ${value}\r\n`), url);
    await clickTerminalLink(page, url);
    const menu = page.getByRole('dialog', { name: '打开终端链接' });
    await expect(menu).toBeVisible();
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(400);
    await page.screenshot({ path: testInfo.outputPath('terminal-link-menu.png') });
    await menu.getByRole('button', { name: '内部预览' }).click();
    await expect(page.frameLocator('.pm-browser-page:not([hidden]) iframe')
      .getByRole('heading', { name: '终端网页预览成功' }))
      .toBeVisible();
    if (remote) expect((await snapshot(page)).links).toEqual([`1:${url}`]);
    await page.getByRole('button', { name: '关闭详情抽屉' }).click();
    await page.screenshot({ path: testInfo.outputPath('after-preview.png') });
    await clickTerminalLink(page, url);
    await menu.getByRole('button', { name: '在浏览器中打开' }).click();
    await expect.poll(async () => (await snapshot(page)).external.length).toBe(1);
    expect((await snapshot(page)).external[0]).toContain('/e2e/terminal-site.html');
    await page.setViewportSize({ width: 640, height: 600 });
    await page.evaluate(() => window.terminalHarness.output('\r\nhttp://192.168.10.15:3002/\r\n'));
    await clickTerminalLink(page, 'http://192.168.10.15:3002/');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
}
