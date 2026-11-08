import { expect, type Page } from '@playwright/test';

async function checkEditorContextMenu(page: Page) {
  const input = page.getByRole('textbox', { name: '编辑消息内容', exact: true });
  const menu = page.getByRole('menu', { name: '文本操作' });
  await input.click({ button: 'right' });
  await expect(menu).toBeVisible();
  const labels = await menu.getByRole('menuitem').allTextContents();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  const bounds = (await input.boundingBox())!;
  const pointer = { pointerId: 8, pointerType: 'touch', isPrimary: true, button: 0,
    clientX: bounds.x + 20, clientY: bounds.y + 12 };
  await input.dispatchEvent('pointerdown', pointer);
  await expect(menu).toBeVisible();
  await input.dispatchEvent('pointerup', pointer);
  await expect(menu.getByRole('menuitem')).toHaveText(labels);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(input).toBeVisible();
  const fontSize = await input.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  expect(fontSize).toBe(new URL(page.url()).searchParams.has('large') ? 20 : 14);
}

export async function checkMessageEditing(page: Page, screenshot: string) {
  const edit = page.getByRole('button', { name: '编辑消息', exact: true });
  const input = page.getByRole('textbox', { name: '编辑消息内容', exact: true });
  await expect(edit).toHaveCount(1, { timeout: 20_000 });
  await page.getByText('请修改最后这条消息。', { exact: true }).hover();
  await edit.click();
  await input.fill('修改后的最后一条消息。');
  await input.press('End');
  await input.press('Shift+Enter');
  await page.keyboard.insertText('字');
  await expect(input).toBeVisible();
  const text = await input.evaluate(node => node instanceof HTMLTextAreaElement ? node.value : node.innerText);
  expect(text).toBe('修改后的最后一条消息。\n字');
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
  await expect(input).toBeVisible();
  await input.dispatchEvent('compositionend');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  const message = page.locator('[data-message-id="user"] article');
  await expect(message).toBeVisible();
  await message.hover();
  await edit.click();
  await input.fill('取消的修改');
  await input.press('Escape');
  await message.hover();
  await edit.click();
  const restored = await input.evaluate(node => node instanceof HTMLTextAreaElement ? node.value : node.innerText);
  expect(restored).toBe(text);
  await checkEditorContextMenu(page);
  const article = input.locator('xpath=ancestor::article');
  const bounds = (await article.boundingBox())!;
  const actions = page.getByRole('button', { name: '删除消息', exact: true });
  const send = page.getByRole('button', { name: '发送', exact: true });
  expect((await actions.boundingBox())!.x).toBeLessThan((await send.boundingBox())!.x);
  expect(bounds.width).toBeGreaterThan(400);
  expect(await article.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  await actions.click();
  const confirm = page.locator('.ant-popconfirm');
  await expect(confirm).toContainText('这条消息及之后的所有消息都会删除，无法撤销。');
  expect((await confirm.boundingBox())!.width).toBeLessThanOrEqual(400);
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(input).toBeVisible();
  await actions.click();
  await confirm.getByRole('button', { name: '删除', exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(page.getByText('请保留这条消息。', { exact: true })).toBeVisible();
  await expect(page.getByText('之前的回复也会保留。', { exact: true })).toBeVisible();
  await expect(edit).toHaveCount(1);
}
