import { describe, expect, it, vi } from 'vitest';
import { emptyTier, publicDraft, type MarketItem } from '../../../../shared/provider-market/types';
import { validDraft } from '../../../../shared/provider-market/validation';
import { personalProviderFields } from '../../../../shared/provider-market/install';
import { marketText } from '../../../../shared/provider-market/i18n';

export const marketFixture = (): MarketItem => ({
  id: '11111111-1111-4111-8111-111111111111', ownerId: 'alice', official: false, published: true,
  revision: 1, userCount: 2, sortOrder: null, name: 'Example', description: 'Public introduction',
  baseUrl: 'https://provider.example/v1', currency: 'USD', unit: 'millionTokens', models: [
    { id: 'model-z', protocol: 'openaiResponses', tiers: [
      { ...emptyTier(5), input: 7, output: 0 }, { ...emptyTier(1), input: 11 },
    ] }, { id: 'model-a', protocol: 'anthropicMessages', tiers: [emptyTier(2)] },
  ],
});
describe('public Provider contract', () => {
  it('loads every released translation offline and switches the market copy', () => {
    const titles = (['zh', 'en', 'ru', 'ja'] as const).map((language) => marketText(language)('market.title'));
    expect(new Set(titles).size).toBe(4);
    for (const title of titles) expect(title).not.toContain('market.title');
    expect(marketText('zh')('market.unit', { currency: 'USD' })).toContain('USD');
  });
  it('preserves independent prices, null and zero and never reorders models or tiers', () => {
    const item = marketFixture();
    expect(validDraft(item)).toBe(true);
    expect(publicDraft(item).models).toEqual(item.models);
    expect(JSON.parse(JSON.stringify(publicDraft(item))).models[0].tiers[0]).toMatchObject({
      input: 7, output: 0, cachedInput: null,
    });
    const privateFields = personalProviderFields(item, ' own-key ');
    expect(privateFields.models).toEqual(['model-z', 'model-a']);
    expect(privateFields.apiKey).toBe('own-key');
    for (const key of ['id', 'active', 'official', 'ownerId', 'modelTokenCosts', 'tiers']) {
      expect(privateFields).not.toHaveProperty(key);
    }
  });
  it('whitelists nested public fields and refuses credential-bearing URLs and invalid prices', () => {
    const item = { ...marketFixture(), apiKey: 'secret', walletPassword: 'secret', headers: { Cookie: 'secret' } };
    expect(JSON.stringify(publicDraft(item))).not.toContain('secret');
    for (const baseUrl of ['https://key@example.com', 'https://example.com/v1?token=secret']) {
      expect(validDraft({ ...item, baseUrl })).toBe(false);
    }
    for (const price of [-1, Infinity, NaN]) {
      const changed = marketFixture(); changed.models[0].tiers[0].input = price;
      expect(validDraft(changed)).toBe(false);
    }
    const duplicate = marketFixture(); duplicate.models.push(duplicate.models[0]);
    expect(validDraft(duplicate)).toBe(false);
    const tiers = marketFixture(); tiers.models[0].tiers.push(tiers.models[0].tiers[0]);
    expect(validDraft(tiers)).toBe(false);
  });
});

const backend = vi.hoisted(() => ({ invoke: vi.fn(), loadCloudAuthState: vi.fn() }));
vi.mock('./backend', () => backend);
vi.mock('../../../../shared/platform/localBackend', async () => await import('./backend'));
vi.mock('../../../../shared/clipboard', () => ({ copyText: vi.fn() }));
import { desktopProviderMarket } from './providerMarket';
it('browsing never saves; explicit anonymous addition saves once without a usage claim', async () => {
  backend.loadCloudAuthState.mockResolvedValue({ authenticated: false });
  backend.invoke.mockResolvedValue({ items: [marketFixture()], total: 1 });
  const save = vi.fn().mockResolvedValue({ id: 'personal' });
  const client = desktopProviderMarket(save);
  await client.request({ type: 'list', scope: 'all', page: 1, search: '' }, null);
  expect(save).not.toHaveBeenCalled();
  await client.add!(marketFixture(), 'key', null);
  expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ apiKey: 'key' }), null);
  expect(backend.invoke).toHaveBeenCalledTimes(1);
});
it('rejects an addition made from a stale account without saving', async () => {
  backend.loadCloudAuthState.mockResolvedValue({ authenticated: true, userId: 'bob', baseUrl: 'https://cloud.test' });
  const save = vi.fn();
  await expect(desktopProviderMarket(save).add!(marketFixture(), 'key', {
    userId: 'alice', baseUrl: 'https://cloud.test',
  })).rejects.toThrow('market.signIn');
  expect(save).not.toHaveBeenCalled();
});

it('reuses native model discovery without persisting or publishing the fetch key', async () => {
  backend.invoke.mockClear().mockResolvedValue(['model-a']);
  const save = vi.fn();
  const client = desktopProviderMarket(save);
  expect(await client.discoverModels!({ baseUrl: 'https://provider.example/v1',
    apiKey: ' temporary-key ', protocol: 'anthropicMessages' })).toEqual(['model-a']);
  expect(backend.invoke).toHaveBeenCalledExactlyOnceWith('fetch_relay_models', {
    request: { baseUrl: 'https://provider.example/v1', apiKey: 'temporary-key',
      providerId: null, options: { apiFormat: 'anthropicMessages' } },
  });
  expect(save).not.toHaveBeenCalled();
});
