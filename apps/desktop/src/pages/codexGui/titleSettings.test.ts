// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadCloudAuthState } from '../../api/backend';
import { GuiTitleSettings } from './titleSettings';

vi.mock('../../api/backend', () => ({
  DEFAULT_CLOUD_BASE_URL: 'https://default.test', hasLocalBackend: false, loadCloudAuthState: vi.fn(),
}));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
const fetcher = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetcher);
  vi.mocked(loadCloudAuthState).mockResolvedValue({ baseUrl: 'https://configured.test/' } as never);
});
afterEach(() => vi.unstubAllGlobals());

it('loads settings for background sends without a tab activation and shares concurrent reads', async () => {
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ model: 'background-model', effort: 'low' }) });
  const settings = new GuiTitleSettings();
  expect(await Promise.all([settings.snapshot(), settings.snapshot()])).toEqual([
    { model: 'background-model', effort: 'low' }, { model: 'background-model', effort: 'low' },
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('fetches once on each refresh, bypasses the cache and reuses the settings for every title', async () => {
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ model: 'custom-model', effort: 'medium' }) });
  const settings = new GuiTitleSettings();
  await settings.refresh();
  expect(await settings.snapshot()).toEqual({ model: 'custom-model', effort: 'medium' });
  await settings.snapshot();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('https://configured.test/chat/title-settings',
    expect.objectContaining({ cache: 'no-store' }));
  await settings.refresh();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('uses defaults offline and retains the last valid configuration on later failures', async () => {
  const settings = new GuiTitleSettings();
  fetcher.mockRejectedValueOnce(new Error('offline'));
  await settings.refresh();
  expect(await settings.snapshot()).toEqual({ model: 'gpt-5.6-luna', effort: 'low' });
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ model: 'custom', effort: 'high' }) });
  await settings.refresh();
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ model: '', effort: 'invalid' }) });
  await settings.refresh();
  expect(await settings.snapshot()).toEqual({ model: 'custom', effort: 'high' });
});

it.each([
  { ok: false, status: 404 },
  { ok: true, json: async () => { throw new SyntaxError('Legacy server returned HTML'); } },
  { ok: true, json: async () => ({}) },
])('falls back to Luna when the admin title endpoint has not been deployed: %j', async (response) => {
  fetcher.mockResolvedValue(response);
  const settings = new GuiTitleSettings();
  await settings.refresh();
  expect(await settings.snapshot()).toEqual({ model: 'gpt-5.6-luna', effort: 'low' });
});
