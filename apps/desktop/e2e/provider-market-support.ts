import { expect, type Page } from '@playwright/test';
import type { MarketItem, MarketPage, MarketRequest } from '../../../shared/provider-market/types';

const emptyTier = (multiplier: number) => ({ multiplier, input: null, output: null, cachedInput: null,
  longContextThreshold: null, longContext: { input: null, output: null, cachedInput: null } });

export async function expectMarketDialogLayout(page: Page) {
  const viewport = page.viewportSize()!;
  const content = page.locator('.provider-market-modal .ant-modal-content');
  const body = page.locator('.provider-market-modal .ant-modal-body');
  await expect(content).toBeVisible();
  const frame = (await content.boundingBox())!;
  const scrollFrame = (await body.boundingBox())!;
  expect(frame.width).toBeCloseTo(viewport.width * .85, 0);
  expect(frame.height).toBeCloseTo(viewport.height * .85, 0);
  expect(frame.x).toBeCloseTo(viewport.width * .075, 0);
  expect(frame.y).toBeCloseTo(viewport.height * .075, 0);
  expect(scrollFrame.x + scrollFrame.width).toBeCloseTo(frame.x + frame.width, 0);
  expect(await content.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await body.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
}

export function fixtureItem(): MarketItem {
  return { id: '11111111-1111-4111-8111-111111111111', ownerId: 'alice', official: false,
    published: true, revision: 1, userCount: 8, sortOrder: null, name: 'Example Gateway',
    reviewStatus: 'approved', reviewReason: '', marketingBadge: null,
    description: 'Public connection settings', baseUrl: 'https://provider.example/v1', currency: 'USD',
    pageLink: { url: 'https://provider.example/dashboard?view=usage#balance', query: 'source=remoteai&tag=a&tag=b',
      headers: { 'X-Source': 'RemoteAI' } },
    unit: 'millionTokens', models: [
      { id: 'model-z', protocol: 'openaiResponses', tiers: [{ ...emptyTier(5), input: 7, output: 0 },
        { ...emptyTier(1), input: 11, longContextThreshold: 200000,
          longContext: { input: 13, output: null, cachedInput: 0 } }] },
      { id: 'model-a', protocol: 'anthropicMessages', tiers: [emptyTier(2)] },
    ], balanceQuery: { url: 'https://provider.example/balance', auth: 'bearer',
      script: "function parseBalance(r) { return {amount:r.balance,currency:'USD'}; }" } };
}
interface Call { command: string; args: Record<string, unknown> }
export async function setupMarket(page: Page, mode: string, authenticated = true,
  list?: (request: Extract<MarketRequest, { type: 'list' }>) => Promise<MarketPage>) {
  // External font availability must not hold the application load event open in UI fixtures.
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  page.on('pageerror', (error) => console.log(`market page error: ${error.message}`));
  page.on('requestfailed', (request) => console.log(`market failed request: ${request.url()} ${request.failure()?.errorText}`));
  const saved: Record<string, unknown>[] = [];
  const publications: Record<string, unknown>[] = [];
  const removals: Record<string, unknown>[] = [];
  const discoveryRequests: Record<string, unknown>[] = [];
  const browserRequests: Record<string, unknown>[] = [];
  let discover = async (_request: Record<string, unknown>): Promise<string[]> => ['model-z', 'model-new'];
  let item = fixtureItem();
  let userId = authenticated ? 'alice' : '';
  const exchange = async (call: Call): Promise<unknown> => {
    if (call.command === 'provider_browser_sync') browserRequests.push(call.args.request as Record<string, unknown>);
    if (call.command === 'fetch_relay_models') {
      const request = call.args.request as Record<string, unknown>;
      discoveryRequests.push(request);
      return discover(request);
    }
    if (call.command === 'get_cloud_auth_state') return { authenticated: !!userId,
      userId, baseUrl: 'http://127.0.0.1:1499' };
    if (call.command === 'cloud_provider_market') {
      const request = call.args.request as Record<string, unknown>;
      if (request.type === 'list') return list
        ? list(request as Extract<MarketRequest, { type: 'list' }>)
        : { items: removals.length || (request.scope !== 'mine' &&
          (!item.published || item.reviewStatus !== 'approved')) ? [] : [item],
        total: removals.length || (request.scope !== 'mine' &&
          (!item.published || item.reviewStatus !== 'approved')) ? 0 : 1 };
      if (request.type === 'get') return item;
      if (request.type === 'save') {
        publications.push(request); item = { ...item, ...request.draft as object,
          published: request.published as boolean, revision: item.revision + 1,
          reviewStatus: request.published ? 'pending' : 'draft', reviewReason: '' };
        return item;
      }
      if (request.type === 'remove') removals.push(request);
      return { ok: true };
    }
    if (call.command === 'save_provider' || call.command === 'cloud_install_market_provider') {
      saved.push(call.args); return { id: 'new-personal', ...call.args.provider as object };
    }
    return call.command.startsWith('plugin:') ? 1 : [];
  };
  await page.exposeFunction('marketInvoke', (command: string, args: Record<string, unknown>) => exchange({ command, args }));
  await page.addInitScript(({ mode, authenticated }) => {
    localStorage.setItem('codex-switch:language', 'en');
    localStorage.setItem('codex-switch.web.language', 'en');
    localStorage.setItem('remoteai:language', 'en');
    if (authenticated) localStorage.setItem('codex-switch.web.session.v1', JSON.stringify({
      baseUrl: location.origin, email: 'alice@test.invalid', accessToken: 'fixture', refreshToken: 'fixture',
    }));
    if (mode === 'local') Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
      invoke: (command: string, args: Record<string, unknown>) =>
        (window as unknown as { marketInvoke: (command: string, args: Record<string, unknown>) => Promise<unknown> })
          .marketInvoke(command, args), transformCallback: () => 1, unregisterCallback: () => {},
    } });
  }, { mode, authenticated });
  await page.route('**/__codex_switch__/api/invoke', async (route) => {
    const result = await exchange(route.request().postDataJSON() as Call);
    await route.fulfill({ json: { ok: true, result } });
  });
  await page.route('**/auth/me', (route) => route.fulfill({ json: { id: userId, role: 'user' } }));
  await page.route('**/sync/providers/*', async (route) => {
    saved.push(route.request().postDataJSON()); await route.fulfill({ json: { id: 'new-personal' } });
  });
  await page.route(/^https?:\/\/[^/]+\/(?:admin\/api\/)?provider-market(?:\/|\?|$)/, async (route) => {
    if (route.request().method() === 'GET') {
      const status = new URL(route.request().url()).searchParams.get('reviewStatus');
      const visible = !status || status === 'all' || status === item.reviewStatus;
      await route.fulfill({ json: { items: visible ? [item] : [], total: visible ? 1 : 0 } }); return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    publications.push(body);
    item = { ...item, ...body.draft as object, revision: item.revision + 1,
      ...(Object.hasOwn(body, 'sortOrder') ? { sortOrder: body.sortOrder as number | null } : {}) };
    if (Object.hasOwn(body, 'badge')) item.marketingBadge = body.badge as MarketItem['marketingBadge'];
    if (Object.hasOwn(body, 'decision')) {
      item.reviewStatus = body.decision as MarketItem['reviewStatus']; item.reviewReason = body.reason as string;
    }
    await route.fulfill({ json: item });
  });
  return { saved, publications, removals, discoveryRequests, browserRequests,
    setDiscovery: (handler: typeof discover) => { discover = handler; },
    switchAccount: () => { userId = 'bob'; },
    setItem: (value: MarketItem) => { item = value; } };
}
