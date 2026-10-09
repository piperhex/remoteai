import { test, expect } from '@playwright/test';
import { openChatList, connect, send, state, fixtureUrl, operationCount } from './chat-helpers';

test('queues supplements on the PC, sends one immediately and restores the rest after reconnecting',
  async ({ page, request }) => {
    await request.post(`${fixtureUrl}/test/reset`);
    await page.goto('./');
    await page.getByPlaceholder('name@example.com').fill('mobile-test@example.test');
    await page.getByPlaceholder('输入登录密码').fill('local-test');
    await page.getByRole('button', { name: '登录并查看' }).click();
    await page.getByRole('button', { name: '同意并登录' }).click();
    await connect(page);
    await expect(page.getByRole('status').filter({ hasText: /P2P|Relay/ }))
      .toBeVisible({ timeout: 20_000 });
    await openChatList(page);
    await page.getByRole('button', { name: '移动端聊天体验', exact: true }).click();
    await send(page, 'slow queue test');
    await expect(page.getByRole('button', { name: '暂停生成' })).toBeVisible();
    await send(page, '先检查边界情况');
    await send(page, '再补充回归测试');
    const queue = page.getByRole('region', { name: '待发送消息', exact: true });
    await expect(queue.getByRole('listitem')).toHaveCount(2);
    const queueBounds = (await queue.boundingBox())!;
    const desktop = page.viewportSize()!.width > 860;
    const leftBounds = (await page.locator(desktop ? '.chat-composer-add' : '.chat-composer').boundingBox())!;
    const rightBounds = (await page.locator(desktop ? '.chat-composer-submit' : '.chat-composer').boundingBox())!;
    expect(queueBounds.x).toBeCloseTo(leftBounds.x, 0);
    expect(queueBounds.x + queueBounds.width).toBeCloseTo(rightBounds.x + rightBounds.width, 0);
    const first = queue.getByRole('listitem').first();
    await expect(queue.getByRole('button', { name: '上移待发送消息' })).toBeDisabled();
    await queue.getByRole('button', { name: '下移待发送消息' }).click();
    await expect(first).toContainText('再补充回归测试');
    await queue.getByRole('button', { name: '上移待发送消息' }).click();
    await expect(first).toContainText('先检查边界情况');
    await page.getByRole('textbox', { name: '聊天消息' }).fill('已有草稿');
    await expect(queue.getByRole('button', { name: '编辑待发送消息' })).toBeDisabled();
    await page.getByRole('textbox', { name: '聊天消息' }).fill('');
    await queue.getByRole('button', { name: '编辑待发送消息' }).click();
    await expect(page.getByRole('textbox', { name: '聊天消息' })).toHaveValue('先检查边界情况');
    await expect(queue.getByRole('listitem')).toHaveCount(1);
    await send(page, '先检查边界情况（已编辑）');
    await expect(queue.getByRole('listitem')).toHaveCount(2);
    await queue.getByRole('button', { name: '选择待发送消息：先检查边界情况（已编辑）', exact: true }).click();
    await queue.getByRole('button', { name: '上移待发送消息' }).click();
    await expect(first).toContainText('先检查边界情况（已编辑）');
    await page.screenshot({ path: test.info().outputPath('queue-controls.png') });
    const streamed = await page.locator('.chat-markdown').last().innerText();
    await expect.poll(() => page.locator('.chat-markdown').last().innerText()).not.toBe(streamed);
    expect(await operationCount(request, 'steer')).toBe(0);
    await queue.getByRole('listitem').filter({ hasText: '先检查边界情况' })
      .getByRole('button', { name: '立即发送' }).click();
    await expect(queue.getByRole('listitem')).toHaveCount(1);
    expect(await operationCount(request, 'steer')).toBe(1);
    await request.post(`${fixtureUrl}/test/disconnect`);
    await expect(page.getByRole('status').filter({ hasText: /P2P|Relay/ }))
      .toBeVisible({ timeout: 20_000 });
    await expect(queue).toContainText('再补充回归测试');
    await page.setViewportSize({ width: 390, height: 480 });
    const bounds = (await queue.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await queue.getByRole('button', { name: '删除待发送消息' }).click();
    await expect(queue).toHaveCount(0);
    await send(page, '自动发送的后续消息');
    await expect(queue).toContainText('自动发送的后续消息');
    await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'complete' } });
    await expect(queue).toHaveCount(0);
    await expect.poll(async () => (await state(request)).operations.filter((entry) => entry.operation === 'send')
      .at(-1)?.text).toBe('自动发送的后续消息');
  });
