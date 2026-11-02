import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyModel, emptyTier, type MarketProtocol } from '../../../../shared/provider-market/types';
import { discoverBrowserModels, mergeDiscoveredModels } from '../../../../shared/provider-market/modelDiscovery';
import { marketText } from '../../../../shared/provider-market/i18n';

afterEach(() => vi.unstubAllGlobals());

describe('market model import', () => {
  it('merges without changing existing protocols, prices, order or unfinished rows', () => {
    const saved = { id: 'existing', protocol: 'openaiChat' as const, tiers: [
      { ...emptyTier(2), input: 0, output: 7, longContextThreshold: 200000,
        longContext: { input: 9, output: 10, cachedInput: null } }, emptyTier(5),
    ] };
    const unfinished = { ...emptyModel(), tiers: [{ ...emptyTier(), input: 3 }] };
    const result = mergeDiscoveredModels([saved, unfinished, emptyModel()],
      ['existing', ' new-model ', 'new-model', '', 'invalid id'], 'anthropicMessages');
    expect(result).toEqual({ models: [saved, unfinished,
      { id: 'new-model', protocol: 'anthropicMessages', tiers: [emptyTier()] }], added: 1, skipped: 0 });
    expect(result.models[0]).toBe(saved);
    expect(result.models[1]).toBe(unfinished);
  });

  it('caps imports at 64 and reports omitted models without dropping existing ones', () => {
    const current = Array.from({ length: 63 }, (_, index) => ({ ...emptyModel(), id: `old-${index}` }));
    const result = mergeDiscoveredModels(current, ['new-a', 'new-b', 'new-c'], 'openaiChat');
    expect(result.models).toHaveLength(64);
    expect(result.models.slice(0, 63)).toEqual(current);
    expect(result).toMatchObject({ added: 1, skipped: 2 });
  });

  it('keeps current rows when refresh finds no new models and rejects empty or unusable lists', () => {
    const current = [{ ...emptyModel(), id: 'existing' }];
    expect(mergeDiscoveredModels(current, ['existing'], 'openaiChat')).toEqual({
      models: current, added: 0, skipped: 0,
    });
    for (const ids of [[], ['invalid id'], ['a'.repeat(129)]]) {
      expect(() => mergeDiscoveredModels(current, ids, 'openaiChat')).toThrow('market.modelsEmpty');
    }
  });

  it('includes offline discovery copy for every released language', () => {
    for (const language of ['en', 'zh', 'ja', 'ru'] as const) {
      const t = marketText(language);
      expect(t('market.fetchModels')).not.toContain('market.');
      expect(t('market.modelsImported', { count: 3 })).toContain('3');
      expect(t('market.modelsLimit', { count: 3 })).not.toContain('{count}');
    }
  });
});

describe('browser model discovery', () => {
  it.each([
    ['openaiResponses', 'https://provider.example/v1/models', 'Authorization', 'Bearer test-key'],
    ['openaiChat', 'https://provider.example/v1/models', 'Authorization', 'Bearer test-key'],
    ['anthropicMessages', 'https://provider.example/v1/models', 'x-api-key', 'test-key'],
    ['geminiGenerateContent', 'https://provider.example/v1beta/models', 'x-goog-api-key', 'test-key'],
  ] as const)('uses %s authentication without cookies or redirects', async (protocol, url, header, value) => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'model-a' }] }) });
    vi.stubGlobal('fetch', fetcher);
    expect(await discoverBrowserModels({ baseUrl: 'https://provider.example', apiKey: ' test-key ', protocol }))
      .toEqual(['model-a']);
    expect(fetcher.mock.calls[0][0].toString()).toBe(url);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error',
      headers: { [header]: value } });
    expect(url).not.toContain('test-key');
  });

  it('follows Gemini pages, normalizes IDs and excludes unsupported generation models', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: URL) => {
      urls.push(url.toString());
      return { ok: true, json: async () => urls.length === 1 ? {
        models: [{ name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embed-a', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next',
      } : { models: [{ name: 'models/gemini-b' }] } };
    }));
    expect(await discoverBrowserModels({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: '', protocol: 'geminiGenerateContent' })).toEqual(['gemini-a', 'gemini-b']);
    expect(urls).toEqual(['https://generativelanguage.googleapis.com/v1beta/models',
      'https://generativelanguage.googleapis.com/v1beta/models?pageToken=next']);
  });

  it('rejects failed, malformed and looping pages without importing a partial list', async () => {
    const connection = { baseUrl: 'https://provider.example/v1', apiKey: '',
      protocol: 'anthropicMessages' as MarketProtocol };
    for (const response of [{ ok: false }, { ok: true, json: async () => ({}) },
      { ok: true, json: async () => ({ data: [{ id: 'a' }], has_more: true }) },
      { ok: true, json: async () => ({ data: [{ id: 'a' }], has_more: true, last_id: 'a' }) }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      await expect(discoverBrowserModels(connection)).rejects.toThrow('market.modelsFetchFailed');
    }
  });
});
