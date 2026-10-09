import { queryProviderBalance } from '../api/backend';
import type { Provider, ProviderBalance } from '../types';
import { formatCurrencyAmount } from '../utils/currencyDisplay';

const BALANCE_CACHE_MS = 60_000;
type BalanceEntry = { detail: string; balance?: ProviderBalance; updatedAt: number; pending: boolean };

function balanceDetail(provider: Provider, balance: ProviderBalance) {
  const quota = provider.balancePlatform === 'codexSwitch';
  const label = quota ? '剩余额度' : '钱包余额';
  if (quota && balance.apiUnlimited) return `${label} 不限额`;
  const amount = quota ? balance.apiAmount : balance.walletAmount;
  const unit = quota ? balance.apiUnit : balance.walletUnit;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return `${label} 暂无余额`;
  return `${label} ${formatCurrencyAmount(amount, unit)}`;
}

/** Balance requests run separately so a slow provider cannot delay the account picker. */
export class GuiAccountBalances {
  private readonly entries = new Map<string, BalanceEntry>();
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  detail(provider: Provider): string {
    if (!provider.balancePlatform) return '钱包余额 暂无余额';
    const existing = this.entries.get(provider.id);
    if (existing && (existing.pending || Date.now() - existing.updatedAt < BALANCE_CACHE_MS)) {
      return existing.balance ? balanceDetail(provider, existing.balance) : existing.detail;
    }
    const entry: BalanceEntry = {
      detail: existing?.detail ?? '正在查询余额…', updatedAt: 0, pending: true,
    };
    this.entries.set(provider.id, entry);
    void queryProviderBalance(provider.id).then((balance) => {
      entry.balance = balance;
      entry.detail = balanceDetail(provider, balance);
    }).catch(() => {
      entry.detail = '余额暂不可用';
    }).finally(() => {
      entry.pending = false;
      entry.updatedAt = Date.now();
      for (const listener of this.listeners) listener();
    });
    return entry.detail;
  }
}

export const guiAccountBalances = new GuiAccountBalances();
