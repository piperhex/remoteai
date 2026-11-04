// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as backend from '../api/backend';
import type { Provider, ProviderBalance } from '../types';
import { setGuiLanguage } from "../../../../shared/localization/uiText";
import { GuiAccountBalances } from './guiAccountBalances';
import { readGuiAccounts } from './guiAccounts';
import { connectionDetails } from './connectionDetails';
import { readTokenSummary } from './tokenSummary';
import { loadOfficialUsage } from '../api/officialUsage';
import { invalidateTokenQueries } from '../../../../shared/token-usage/queryCache';

vi.mock('../api/backend', () => ({ invoke: vi.fn(), queryProviderBalance: vi.fn(), hasLocalBackend: false,
  isDesktopApp: true, isHostedWebApp: false,
  loadAppSettings: vi.fn(), loadTokenUsageEntries: vi.fn(), loadDailyTokenUsage: vi.fn(),
  loadTokenUsageBreakdown: vi.fn(), loadAccountQuotaHistory: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../api/officialUsage', () => ({ loadOfficialUsage: vi.fn() }));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));

const provider = { id: 'third-party', balancePlatform: 'newApi' } as Provider;
const balance: ProviderBalance = {
  walletAmount: 12.34, walletUnit: 'CNY', apiAmount: 99, apiUnit: 'USD', apiUnlimited: false, queriedAt: 1,
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(async () => { await invalidateTokenQueries(''); vi.resetAllMocks(); localStorage.clear(); });
afterEach(() => { setGuiLanguage('zh'); connectionDetails.reset(); });

it('formats balance details in the current host language on every read', async () => {
  let finish!: (value: ProviderBalance) => void;
  vi.mocked(backend.queryProviderBalance).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const balances = new GuiAccountBalances();
  setGuiLanguage('ru');
  expect(balances.detail(provider)).toBe('Запрос баланса…');
  setGuiLanguage('en');
  expect(balances.detail(provider)).toBe('Checking balance…');
  finish(balance);
  await settle();
  expect(balances.detail(provider)).toBe('Wallet balance: 12.34 CNY');
  setGuiLanguage('ru');
  expect(balances.detail(provider)).toBe('Баланс кошелька: 12.34 CNY');
  expect(balances.detail({ ...provider, balancePlatform: null })).toBe('Баланс кошелька: нет данных');
  setGuiLanguage('zh');
  expect(balances.detail(provider)).toBe('钱包余额 12.34 CNY');
});

it('keeps the previous result during a refresh and reports failures in the host language', async () => {
  vi.mocked(backend.queryProviderBalance).mockResolvedValueOnce({ ...balance, apiUnlimited: true });
  const quota = { ...provider, balancePlatform: 'codexSwitch' as const };
  const balances = new GuiAccountBalances();
  setGuiLanguage('ru');
  balances.detail(quota);
  await settle();
  expect(balances.detail(quota)).toBe('Остаток лимита: без ограничений');
  vi.useFakeTimers();
  try {
    vi.advanceTimersByTime(60_001);
    let fail!: (error: Error) => void;
    vi.mocked(backend.queryProviderBalance).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    expect(balances.detail(quota)).toBe('Остаток лимита: без ограничений');
    fail(new Error('private query details'));
    await settle();
    expect(balances.detail(quota)).toBe('Баланс временно недоступен');
    setGuiLanguage('en');
    expect(balances.detail(quota)).toBe('Balance temporarily unavailable');
    vi.advanceTimersByTime(60_001);
    vi.mocked(backend.queryProviderBalance).mockResolvedValue({ ...balance, apiAmount: null });
    expect(balances.detail(quota)).toBe('Balance temporarily unavailable');
    await settle();
    expect(balances.detail(quota)).toBe('Remaining quota: no data');
  } finally {
    vi.useRealTimers();
  }
});

it('reports malformed balance data as unavailable', async () => {
  vi.mocked(backend.queryProviderBalance).mockResolvedValue(null as unknown as ProviderBalance);
  const balances = new GuiAccountBalances();
  balances.detail(provider);
  await settle();
  expect(balances.detail(provider)).toBe('余额暂不可用');
});

it('sends account picker details in the host language', async () => {
  vi.mocked(backend.invoke).mockImplementation(async (command) => {
    if (command === 'codex_gui_account_selection') return { kind: 'account', id: 'gui' };
    if (command === 'list_accounts') return [
      { id: 'unknown', email: 'unknown@example.test', localProxyCompatible: true },
      { id: 'gui', email: 'gui@example.test', plan: 'pro', localProxyCompatible: true,
        usage: { primary: { remainingPercent: 82.4 }, secondary: { remainingPercent: 0 } } },
    ];
    if (command === 'list_providers') return [];
    if (command === 'list_aggregate_apis') return [];
    throw new Error('Unexpected command');
  });
  setGuiLanguage('ru');
  const choices = (await readGuiAccounts()).choices;
  expect(choices.map((choice) => choice.detail)).toEqual([
    'Тариф неизвестен · Остаток: основной —, второй —',
    'pro · Остаток: основной 82%, второй 0%',
  ]);
  expect(choices[0]).toMatchObject({ plan: 'Тариф неизвестен' });
  setGuiLanguage('en');
  expect((await readGuiAccounts()).choices[1].detail).toBe('pro · Remaining: primary 82%, secondary 0%');
});

it('names unnamed devices in the host language and keeps reported names verbatim', () => {
  setGuiLanguage('ru');
  connectionDetails.open('unnamed', {});
  connectionDetails.open('named', { name: '其他设备 (Pixel)', platform: 'android' });
  expect(connectionDetails.getSnapshot().devices.map((device) => device.name))
    .toEqual(['Другое устройство', '其他设备 (Pixel)']);
});

it('labels usage without an account in the host language', async () => {
  vi.mocked(backend.loadAppSettings).mockResolvedValue({ tokenUsageWeeks: 4, tokenUsageRefreshSeconds: 30,
    floatingBubbleEnabled: false, privacyMode: false, hideAccountNotes: false,
    bubbleResetDisplay: 'countdown', bubbleStyle: 'classic' });
  vi.mocked(backend.loadTokenUsageEntries).mockResolvedValue([
    { id: 'one', ts: 1, provider: 'Work', model: 'model', accountEmail: 'me@example.test', totalTokens: 100 },
    { id: 'two', ts: 2, provider: 'Work', model: 'model', totalTokens: 50 },
  ]);
  vi.mocked(backend.loadDailyTokenUsage).mockResolvedValue([]);
  vi.mocked(backend.loadTokenUsageBreakdown).mockResolvedValue([]);
  vi.mocked(backend.loadAccountQuotaHistory).mockResolvedValue([]);
  vi.mocked(loadOfficialUsage).mockResolvedValue({ accounts: [], status: 'signedOut', updatedAt: 0 });
  setGuiLanguage('ru');
  const summary = await readTokenSummary(4);
  expect(summary.rankings.accounts.map(([name]) => name)).toEqual(['me@example.test', 'Неопознанный аккаунт']);
});
