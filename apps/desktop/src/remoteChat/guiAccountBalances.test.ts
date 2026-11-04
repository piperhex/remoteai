import { afterEach, expect, it, vi } from 'vitest';
import { queryProviderBalance } from '../api/backend';
import type { Provider, ProviderBalance } from '../types';
import { GuiAccountBalances } from './guiAccountBalances';

vi.mock('../api/backend', () => ({ queryProviderBalance: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

const provider = { id: 'third-party', balancePlatform: 'newApi' } as Provider;
const balance: ProviderBalance = {
  walletAmount: 12.34, walletUnit: 'CNY', apiAmount: 99, apiUnit: 'USD', apiUnlimited: false, queriedAt: 1,
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

it('returns immediately during a slow query, coalesces refreshes and notifies when the wallet arrives', async () => {
  let finish!: (value: ProviderBalance) => void;
  vi.mocked(queryProviderBalance).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const balances = new GuiAccountBalances();
  const changed = vi.fn();
  const stop = balances.subscribe(changed);
  expect(balances.detail(provider)).toBe('正在查询余额…');
  expect(balances.detail(provider)).toBe('正在查询余额…');
  expect(queryProviderBalance).toHaveBeenCalledTimes(1);
  finish(balance);
  await settle();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(balances.detail(provider)).toBe('钱包余额 12.34 CNY');
  expect(queryProviderBalance).toHaveBeenCalledTimes(1);
  stop();
  vi.useFakeTimers();
  vi.advanceTimersByTime(60_001);
  balances.detail(provider);
  finish({ ...balance, walletAmount: 0 });
  await settle();
  expect(balances.detail(provider)).toBe('钱包余额 0.00 CNY');
  expect(changed).toHaveBeenCalledTimes(1);
});

it.each([0, -2, 25.123])('keeps wallet amount %s separate from API credit', async (amount) => {
  vi.mocked(queryProviderBalance).mockResolvedValue({ ...balance, walletAmount: amount });
  const balances = new GuiAccountBalances();
  balances.detail(provider);
  await settle();
  expect(balances.detail(provider)).toBe(`钱包余额 ${amount.toFixed(2)} CNY`);
});

it('does not invent wallet funds from API credit when wallet data is missing', async () => {
  vi.mocked(queryProviderBalance).mockResolvedValue({ ...balance, walletAmount: null });
  const balances = new GuiAccountBalances();
  balances.detail(provider);
  await settle();
  expect(balances.detail(provider)).toBe('钱包余额 暂无余额');
  expect(balances.detail({ ...provider, balancePlatform: null })).toBe('钱包余额 暂无余额');
});

it('uses the existing API quota semantics for Remote AI accounts', async () => {
  const api = { ...provider, balancePlatform: 'codexSwitch' as const };
  vi.mocked(queryProviderBalance).mockResolvedValue(balance);
  const balances = new GuiAccountBalances();
  balances.detail(api);
  await settle();
  expect(balances.detail(api)).toBe('剩余额度 99.00 USD');
});

it('contains query failures and avoids a retry loop from change events', async () => {
  vi.mocked(queryProviderBalance).mockRejectedValue(new Error('private query details'));
  const balances = new GuiAccountBalances();
  balances.detail(provider);
  await settle();
  expect(balances.detail(provider)).toBe('余额暂不可用');
  expect(queryProviderBalance).toHaveBeenCalledTimes(1);
});
