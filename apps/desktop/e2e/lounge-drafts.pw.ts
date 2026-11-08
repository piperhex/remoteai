import { expect, test, type Page } from '@playwright/test';
import { setupLounge, pixel } from './lounge-support';

async function selectConversation(page: Page, name: string, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: /^聊天/ }).click();
  await page.locator('.lounge-person, .lounge-chat-row-main')
    .and(page.getByRole('button', { name, exact: true })).filter({ visible: true }).click();
}

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: keeps each conversation draft, images and reply when switching`, async ({ page }) => {
    const mobile = mode === 'mobile';
    const web = mode === 'web' || mobile;
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const relay = await setupLounge(page, web);
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    if (mobile) {
      await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
      await page.locator('.discovery-lounge').click();
      await page.getByRole('button', { name: '群聊', exact: true }).click();
    } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    relay.push('群聊引用内容'); relay.private('bob 的消息');
    relay.private('carol 的消息', { id: 'carol', account: 'carol@example.test' });
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('群聊中尚未发送的草稿');
    await page.locator('.lounge-composer input[type=file]').setInputFiles({ name: 'draft.png', mimeType: 'image/png',
      buffer: Buffer.from(pixel.split(',')[1], 'base64') });
    await expect(page.locator('.lounge-attachments img')).toHaveCount(1);
    await page.locator('.lounge-message').filter({ hasText: '群聊引用内容' })
      .locator('.lounge-bubble').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '引用回复' }).click();
    await selectConversation(page, '与 bob 私聊', mobile);
    await expect(input).toHaveValue('');
    await expect(page.locator('.lounge-attachments img, .lounge-reply-draft')).toHaveCount(0);
    await input.fill('给 bob 的独立草稿');
    await selectConversation(page, '与 carol 私聊', mobile);
    await expect(input).toHaveValue(''); await input.fill('给 carol 的独立草稿');
    await selectConversation(page, '群聊', mobile);
    await expect(input).toHaveValue('群聊中尚未发送的草稿');
    await expect(page.locator('.lounge-attachments img')).toHaveCount(1);
    await expect(page.locator('.lounge-reply-draft')).toContainText('群聊引用内容');
    await expect(page.getByText('请先登录', { exact: true })).toBeHidden();
    await page.screenshot({ path: `../../.codex-tmp/lounge-drafts-${mode}-group-restored.png` });
    await selectConversation(page, '与 bob 私聊', mobile);
    await expect(input).toHaveValue('给 bob 的独立草稿');
    await page.screenshot({ path: `../../.codex-tmp/lounge-drafts-${mode}-private-restored.png` });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(input).toHaveValue('');
    await selectConversation(page, '与 carol 私聊', mobile);
    await expect(input).toHaveValue('给 carol 的独立草稿');
    await selectConversation(page, '群聊', mobile);
    await expect(input).toHaveValue('群聊中尚未发送的草稿');
    relay.groupReply('manual');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(2);
    await selectConversation(page, '与 bob 私聊', mobile);
    await expect(input).toHaveValue('');
    await input.fill('等待群聊发送期间编辑的私聊草稿');
    await selectConversation(page, '群聊', mobile);
    await input.fill('发送后继续编辑的新草稿');
    relay.acceptGroup(1);
    await expect(input).toHaveValue('发送后继续编辑的新草稿');
    await expect(page.locator('.lounge-attachments img, .lounge-reply-draft')).toHaveCount(0);
    await selectConversation(page, '与 bob 私聊', mobile);
    await expect(input).toHaveValue('等待群聊发送期间编辑的私聊草稿');
    await selectConversation(page, '群聊', mobile);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(3);
    relay.rejectGroup(2);
    await expect(page.locator('.lounge-composer-error')).toBeVisible();
    await selectConversation(page, '与 carol 私聊', mobile);
    await expect(input).toHaveValue('给 carol 的独立草稿');
    await selectConversation(page, '群聊', mobile);
    await expect(input).toHaveValue('发送后继续编辑的新草稿');
  });
}
