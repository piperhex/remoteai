import type { Page } from '@playwright/test';
import type { MarketItem } from '../../../shared/provider-market/types';
import { fixtureItem } from './provider-market-support';

interface Options { dark?: boolean; role?: 'all' | 'read' | 'review'; count?: number; language?: string }
export async function setupAdminTable(page: Page, options: Options = {}) {
  const permissions = (options.role === 'read' ? ['read'] : options.role === 'review'
    ? ['read', 'review'] : ['read', 'manage', 'review', 'order', 'promote'])
    .map(value => `admin.provider-market.${value}`);
  const user = { id: 'admin-fixture', email: 'market-admin@example.com', role: 'admin', permissions };
  await page.addInitScript(({ user, options }) => {
    localStorage.setItem('codex-switch-admin-auth', JSON.stringify({ user, accessToken: 'fixture', refreshToken: 'fixture' }));
    localStorage.setItem('codex-switch-admin-language', options.language ?? 'zh');
    localStorage.setItem('codex-switch-admin-theme', options.dark ? 'dark' : 'light');
  }, { user, options });
  const names = ['魔力方舟', 'YYLX', 'XycAi', 'Remote AI 官方', '待补充配置', '未通过示例'];
  let items: MarketItem[] = Array.from({ length: options.count ?? names.length }, (_, index) => ({
    ...fixtureItem(), id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    name: names[index] ?? `Provider ${index + 1}`, official: index === 3, userCount: index * 12,
    published: index !== 4, sortOrder: index === 3 ? 1 : null,
    marketingBadge: index === 3 ? { text: '推荐', tone: 'blue' } : null,
    reviewStatus: index === 3 ? 'approved' : index === 4 ? 'draft' : index === 5 ? 'rejected' : 'pending',
  }));
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  let conflict = false;
  await page.route('**/auth/me', route => route.fulfill({ json: user }));
  await page.route('**/admin/api/provider-market**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      const status = url.searchParams.get('reviewStatus');
      const search = url.searchParams.get('search') ?? '';
      const current = Number(url.searchParams.get('page') ?? 1);
      const visible = items.filter(item => item.name.includes(search) &&
        (!status || status === 'all' || item.reviewStatus === status));
      await route.fulfill({ json: { items: visible.slice((current - 1) * 40, current * 40), total: visible.length } });
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    mutations.push({ path: url.pathname, body });
    if (conflict) {
      await route.fulfill({ status: 409, json: { message: 'market.conflict' } }); return;
    }
    const entries = body.items as { id: string; revision: number }[] | undefined;
    const ids = entries?.map(item => item.id) ?? [url.pathname.split('/')[4]];
    if (url.pathname.endsWith('/batch/delete') || request.method() === 'DELETE') {
      items = items.filter(item => !ids.includes(item.id));
    } else {
      items = items.map(item => !ids.includes(item.id) ? item : { ...item, revision: item.revision + 1,
        ...(body.decision ? { reviewStatus: body.decision as MarketItem['reviewStatus'],
          reviewReason: String(body.reason) } : {}),
        ...('sortOrder' in body ? { sortOrder: body.sortOrder as number | null } : {}),
        ...('badge' in body ? { marketingBadge: body.badge as MarketItem['marketingBadge'] } : {}),
      });
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/admin.html');
  return { mutations, setConflict: (value: boolean) => { conflict = value; } };
}
