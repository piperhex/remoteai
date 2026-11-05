import { test, expect } from '@playwright/test';

declare global {
  interface Window { outboxFixture: ReturnType<typeof import('../../../shared/remote-chat/testing/localOutboxFixture')
    .createLocalOutboxFixture> }
}

test('keeps the next draft when a background request creates the conversation', async ({ page }) => {
  await page.goto('/e2e/local-outbox-harness.html');
  const input = page.getByRole('textbox', { name: '消息' });
  await expect(input).toBeEnabled();
  await page.evaluate(() => window.outboxFixture.controller.back());
  await input.fill('新聊天的第一条消息');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('等待创建时继续输入的草稿');
  await page.evaluate(() => window.outboxFixture.accept());
  await expect.poll(() => page.evaluate(() => window.outboxFixture.controller.snapshot().selected?.id))
    .toBe('outbox-chat');
  await expect(input).toHaveValue('等待创建时继续输入的草稿');
});

test('restores a failed first message before a conversation has been created', async ({ page }) => {
  await page.goto('/e2e/local-outbox-harness.html');
  const input = page.getByRole('textbox', { name: '消息' });
  await expect(input).toBeEnabled();
  await page.evaluate(() => window.outboxFixture.controller.back());
  await input.fill('创建失败也保留这条消息');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(input).toHaveValue('');
  await page.evaluate(() => window.outboxFixture.fail());
  const queue = page.getByRole('region', { name: '待发送消息' });
  await expect(queue.getByRole('alert')).toBeVisible();
  await queue.getByRole('button', { name: '编辑待发送消息' }).click();
  await expect(input).toHaveValue('创建失败也保留这条消息');
});

for (const mode of ['desktop-remote', 'web-desktop', 'web-mobile']) {
  test(`${mode} accepts drafts before the computer acknowledges them`, async ({ page }, info) => {
    await page.setViewportSize(mode === 'web-mobile' ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto(`/e2e/local-outbox-harness.html${mode === 'desktop-remote' ? '?desktop' : ''}`);
    const input = page.getByRole('textbox', { name: '消息' });
    await expect(input).toBeEnabled();
    await input.fill('第一条消息立即进入本地队列');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(input).toHaveValue('');
    const queue = page.getByRole('region', { name: '待发送消息' });
    await expect(queue.getByText('第一条消息立即进入本地队列', { exact: true })).toBeVisible();
    await input.fill('第二条消息可以继续发送');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(queue.locator('li')).toHaveCount(2);
    expect(await page.evaluate(() => window.outboxFixture.pending())).toBe(1);
    await page.screenshot({ path: info.outputPath(`${mode}-pending.png`) });
    await page.evaluate(() => window.outboxFixture.accept());
    await expect(queue.locator('li')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => window.outboxFixture.pending())).toBe(1);
    await page.evaluate(() => window.outboxFixture.fail());
    await expect(queue.getByRole('alert')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${mode}-failed.png`) });
    await queue.getByRole('button', { name: '选择待发送消息：第二条消息可以继续发送' }).click();
    await queue.getByRole('button', { name: '编辑待发送消息' }).click();
    await expect(input).toHaveValue('第二条消息可以继续发送');
  });
}
