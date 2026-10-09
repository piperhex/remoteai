import { guiText } from "../../i18n/guiText";
import { useEffect, useState } from "react";
import { queryProviderBalance, subscribeToProviderBalance } from "../../api/backend";
import type { Provider, ProviderBalance } from "../../types";
import { useCurrencyFormatter } from "../../hooks/useTokenCostDisplaySettings";

const WALLET_REFRESH_INTERVAL_MS = 60_000;

export function useProviderWallet(provider: Provider | undefined, active: boolean) {
  const formatAmount = useCurrencyFormatter();
  const [result, setResult] = useState<{ id: string; balance: ProviderBalance } | null>(null);
  const id = provider?.id;
  const platform = provider?.balancePlatform;
  const balanceUrl = provider?.balanceQueryUrl;
  const walletUrl = provider?.walletQueryUrl;

  useEffect(() => {
    setResult(null);
    if (!active || !id || !platform) return;
    let cancelled = false;
    let pending = false;
    const update = (balance: ProviderBalance) => {
      if (!cancelled) setResult({ id, balance });
    };
    const refresh = async () => {
      if (pending || cancelled) return;
      pending = true;
      try { update(await queryProviderBalance(id)); }
      catch { if (!cancelled) setResult(null); }
      finally { pending = false; }
    };
    const unsubscribe = subscribeToProviderBalance(id, update);
    void refresh();
    const timer = setInterval(() => void refresh(), WALLET_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); unsubscribe(); };
  }, [active, id, platform, balanceUrl, walletUrl]);

  const balance = active && platform && result?.id === id ? result?.balance : null;
  if (platform === "codexSwitch") {
    if (balance?.apiUnlimited) return guiText("不限额");
    if (typeof balance?.apiAmount !== "number" || !Number.isFinite(balance.apiAmount)) return null;
    return formatAmount(balance.apiAmount, balance.apiUnit);
  }
  if (typeof balance?.walletAmount !== "number" || !Number.isFinite(balance.walletAmount)) return null;
  return formatAmount(balance.walletAmount, balance.walletUnit);
}
