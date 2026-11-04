import { queryProviderBalance } from '../api/backend';
import type { Provider, ProviderBalance } from '../types';
import { formatCurrencyAmount } from '../utils/currencyDisplay';
import { uiText } from "../../../../shared/localization/uiText";

const BALANCE_CACHE_MS = 60_000;
// Keep the query state instead of formatted text so every read uses the current interface language.
type BalanceEntry = { balance?: ProviderBalance; failed: boolean; updatedAt: number; pending: boolean };

function balanceDetail(provider: Provider, balance: ProviderBalance) {
  const quota = provider.balancePlatform === 'codexSwitch';
  if (quota && balance.apiUnlimited) return uiText("client.remoteHostData.remainingQuotaUnlimited");
  const amount = quota ? balance.apiAmount : balance.walletAmount;
  const unit = quota ? balance.apiUnit : balance.walletUnit;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return uiText(quota ? "client.remoteHostData.remainingQuotaNoData" : "client.remoteHostData.walletBalanceNoData");
  }
  return uiText(quota ? "client.remoteHostData.remainingQuota" : "client.remoteHostData.walletBalance", { amount: formatCurrencyAmount(amount, unit) });
}

function entryDetail(provider: Provider, entry: BalanceEntry) {
  if (entry.balance) return balanceDetail(provider, entry.balance);
  return uiText(entry.failed ? "client.remoteHostData.balanceTemporarilyUnavailable" : "client.remoteHostData.checkingBalance");
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
    if (!provider.balancePlatform) return uiText("client.remoteHostData.walletBalanceNoData");
    const existing = this.entries.get(provider.id);
    if (existing && (existing.pending || Date.now() - existing.updatedAt < BALANCE_CACHE_MS)) {
      return entryDetail(provider, existing);
    }
    // A refresh keeps showing the previous result until the new query settles.
    const entry: BalanceEntry = {
      balance: existing?.balance, failed: existing?.failed ?? false, updatedAt: 0, pending: true,
    };
    this.entries.set(provider.id, entry);
    void queryProviderBalance(provider.id).then((balance) => {
      // Format once so malformed data is reported as unavailable instead of failing later reads.
      balanceDetail(provider, balance);
      entry.balance = balance;
      entry.failed = false;
    }).catch(() => {
      entry.balance = undefined;
      entry.failed = true;
    }).finally(() => {
      entry.pending = false;
      entry.updatedAt = Date.now();
      for (const listener of this.listeners) listener();
    });
    return entryDetail(provider, entry);
  }
}

export const guiAccountBalances = new GuiAccountBalances();
