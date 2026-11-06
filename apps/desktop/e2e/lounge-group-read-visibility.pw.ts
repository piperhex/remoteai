import { expect, test, type Locator } from '@playwright/test';
import { openReadGroup, foreground } from './lounge-group-read-support';

async function showFraction(bubble: Locator, fraction: number) {
  return bubble.evaluate((node, fraction) => {
    const log = node.closest<HTMLElement>('.lounge-conversation')!;
    const viewport = log.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    log.scrollTop += rect.top - (viewport.top + log.clientTop + log.clientHeight * (1 - fraction));
    return { height: rect.height, viewport: log.clientHeight };
  }, fraction);
}

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: long group messages read only after enough height stays visible`, async ({ page }) => {
    const relay = await openReadGroup(page, mode);
    relay.policy(false);
    await foreground(page, false);
    relay.push(`通知前的聊天记录\n${'之前的消息\n'.repeat(70)}`);
    const id = `long-notice-${mode}`;
    const groupReceipt = `long-notice-capability-${mode}`;
    const heading = '请阅读这条较长的群聊通知';
    relay.frame({ type: 'message', id, groupReceipt,
      sender: { id: 'manager', account: 'manager', nickname: '群管理员', moderator: true },
      text: `${heading}\n${'本条通知包含多项安排，请滚动查看完整内容。\n'.repeat(140)}`,
      images: [], sentAt: new Date().toISOString() });
    relay.push(`通知后的聊天记录\n${'之后的消息\n'.repeat(70)}`);
    const bubble = page.locator('.lounge-bubble').filter({ hasText: heading });
    await expect(bubble).toHaveCount(1);
    const dimensions = await showFraction(bubble, 0.2);
    expect(dimensions.height).toBeGreaterThan(dimensions.viewport * 3);
    await foreground(page, true);
    await page.waitForTimeout(650);
    await expect(page.locator('.adm-toast-main')).toBeHidden();
    expect(relay.groupReadFrames).toEqual([]);
    await page.screenshot({ path: `../../.codex-tmp/long-group-read-${mode}-partial.png` });
    await showFraction(bubble, 0.7);
    await page.waitForTimeout(200);
    await showFraction(bubble, 0.2);
    await page.waitForTimeout(650);
    expect(relay.groupReadFrames).toEqual([]);
    await showFraction(bubble, 0.7);
    await expect.poll(() => relay.groupReadFrames.map(frame => frame.id)).toEqual([id]);
    relay.frame({ type: 'group-read-confirm', id, from: 'manager', to: 'alice', groupReceipt });
    await page.screenshot({ path: `../../.codex-tmp/long-group-read-${mode}-read.png` });
  });
}
