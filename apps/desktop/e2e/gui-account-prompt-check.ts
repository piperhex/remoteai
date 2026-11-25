import type { expect as playExpect, Page, TestInfo } from '@playwright/test';

export async function checkRemoteAccountPrompt(page: Page, info: TestInfo,
  mode: 'remote' | 'web', expect: typeof playExpect) {
  const choose = page.getByRole('button', { name: '选择账户', exact: true });
  const notice = page.getByRole('status').filter({ hasText: '请选择可用账户。' });
  await expect(choose).toBeVisible();
  await expect(notice).toBeVisible();
  const draft = page.getByRole('textbox', { name: '聊天消息' });
  await draft.fill('保留草稿');
  const send = page.getByRole('button', { name: '发送消息', exact: true });
  await expect(send).toBeDisabled();
  await expect(page.locator('.adm-toast-mask')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(mode + '-unselected.png'), animations: 'disabled' });
  const drawer = (page.viewportSize()?.width ?? 1280) <= 860;
  if (!drawer) await page.getByRole('button', { name: '收起聊天列表', exact: true }).click();
  await choose.click();
  const account = page.getByRole('region', { name: '账户列表' }).getByRole('button', { name: /演示账户一/ });
  await account.click({ trial: true });
  await page.screenshot({ path: info.outputPath(mode + '-picker.png'), animations: 'disabled' });
  await account.click();
  await expect(notice).toHaveCount(0);
  await expect(choose).toHaveCount(0);
  if (drawer) await page.locator('.chat-drawer .ant-drawer-close').click();
  await expect(page.getByRole('button', { name: drawer ? /聊天设置$/ : /^模型与推理强度/ })).toBeEnabled();
  await expect(draft).toHaveValue('保留草稿');
  await expect(send).toBeEnabled();
  await draft.focus();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath(mode + '-selected.png'), animations: 'disabled' });
}
