import { type Page } from '@playwright/test';
import { setupLounge } from './lounge-support';

export async function openReadGroup(page: Page, mode: string) {
  const mobile = mode === 'mobile';
  const web = mode === 'web' || mobile;
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const relay = await setupLounge(page, web);
  relay.groupReply('manual');
  await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
  await relay.ready();
  relay.frame({ type: 'ready', groupReads: true, direct: true, receipts: true,
    user: { id: 'alice', account: 'alice', moderator: true }, policy: { moderator: true, mutedUntil: null } });
  if (mobile) {
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    await page.locator('.discovery-lounge').click();
    await page.getByRole('button', { name: '群聊', exact: true }).click();
  } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
  return relay;
}

export function foreground(page: Page, visible: boolean) {
  return page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'visible' : 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !value });
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}
