import { openLoungeAction, expectLoungePresence } from './lounge-mobile-actions';
import { expect, test } from '@playwright/test';
import { setupLounge } from './lounge-support';

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: endpoint receipts, online-only retry and durable deduplication`, async ({ page }) => {
    test.setTimeout(120_000);
    const mobile = mode === 'mobile'; const web = mode === 'web' || mobile;
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const relay = await setupLounge(page, web); relay.acknowledge(false);
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    const enter = async () => {
      if (mobile) {
        await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
        await page.locator('.discovery-lounge').click();
        await page.getByRole('button', { name: '群聊', exact: true }).click();
      } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    };
    const people = async () => { if (mobile) await page.getByRole('button', { name: /^聊天/ }).click(); };
    const selectBob = async () => {
      await people();
      await page.locator('.lounge-person, .lounge-chat-row-main')
        .and(page.getByRole('button', { name: '与 bob 私聊', exact: true })).filter({ visible: true }).click();
      if (mobile) await expect(page.locator('.ant-drawer-mask:visible')).toHaveCount(0);
    };
    await relay.ready(); await enter(); relay.push('start-private');
    await page.locator('.lounge-bubble').filter({ hasText: 'start-private' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '发起私聊' }).click();
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('ack-retry');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('img', { name: '等待对方接收', exact: true })).toBeVisible();
    await expect.poll(() => relay.sent.length).toBe(1);
    const id = relay.sent[0].id;
    relay.contact(false); await expectLoungePresence(page, '离线');
    await page.waitForTimeout(5500); expect(relay.sent).toHaveLength(1);
    await page.reload(); await enter(); await selectBob();
    await expect(page.getByRole('img', { name: '等待对方接收', exact: true })).toBeVisible();
    expect(relay.sent).toHaveLength(1);
    relay.contact(true); await expect.poll(() => relay.sent.length, { timeout: 7000 }).toBeGreaterThan(1);
    expect(new Set(relay.sent.map(frame => frame.id))).toEqual(new Set([id]));
    await expect(page.locator('.lounge-message')).toHaveCount(1);
    relay.receipt(id, 'delivered');
    await expect(page.getByRole('img', { name: '对方已收到', exact: true })).toBeVisible();
    await expect(page.locator('.lounge-delivery')).toHaveCSS('color', 'rgb(140, 147, 157)');
    const count = relay.sent.length; await page.waitForTimeout(5500); expect(relay.sent).toHaveLength(count);
    relay.receipt(id, 'read');
    await expect(page.getByRole('img', { name: '对方已阅读', exact: true })).toBeVisible();
    await expect(page.locator('.lounge-delivery')).toHaveCSS('color', 'rgb(40, 163, 107)');
    relay.receipt(id, 'delivered');
    await page.reload(); await enter(); await selectBob();
    await expect(page.getByRole('img', { name: '对方已阅读', exact: true })).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/lounge-ack-${mode}.png` });
    await people(); await page.getByRole('button', { name: /^群聊/ }).filter({ visible: true }).click();
    const incoming = relay.private('deduplicated-private');
    await expect.poll(() => relay.receipts.some(frame => frame.id === incoming && frame.status === 'delivered')).toBe(true);
    expect(relay.receipts.some(frame => frame.id === incoming && frame.status === 'read')).toBe(false);
    relay.private('deduplicated-private', undefined, incoming); await selectBob();
    await expect(page.getByText('deduplicated-private', { exact: true })).toHaveCount(1);
    await expect.poll(() => relay.receipts.some(frame => frame.id === incoming && frame.status === 'read')).toBe(true);
    await page.reload(); await enter(); relay.private('deduplicated-private', undefined, incoming);
    await selectBob(); await expect(page.getByText('deduplicated-private', { exact: true })).toHaveCount(1);
    await openLoungeAction(page, '历史记录');
    await page.getByRole('textbox', { name: '搜索消息或账户' }).fill('ack-retry');
    await expect(page.getByRole('dialog', { name: '历史记录', exact: true })
      .getByRole('img', { name: '对方已阅读', exact: true })).toBeVisible();
  });
}
