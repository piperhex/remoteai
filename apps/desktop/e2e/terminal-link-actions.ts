import { expect, type Page } from '@playwright/test';

export async function clickTerminalLink(page: Page, text: string) {
  const link = page.locator('.xterm-rows:visible').getByText(text, { exact: false });
  await expect(link).toBeVisible();
  // xterm renders text with pointer-events:none and handles links on its screen overlay.
  // Recalculate while the details drawer animates and the terminal fits its new width.
  let point = { x: 0, y: 0 };
  await page.mouse.move(0, 0);
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
    return page.locator('.xterm-screen:visible').evaluate(element => getComputedStyle(element).cursor);
  }).toBe('pointer');
  await page.mouse.click(point.x, point.y);
}
