import type { Language, Translate } from "../i18n";
import type { Provider, ProviderBalance, ProviderTokenUsageTotals } from "../types";
import { formatCompactTokenCount } from "../utils/tokenContext";
import { useCurrencyFormatter } from "../hooks/useTokenCostDisplaySettings";
import type { CurrencyFormatter } from "../utils/currencyDisplay";

interface FloatingProviderCardProps {
  balance: ProviderBalance | null;
  balanceError: boolean;
  language: Language;
  loading: boolean;
  provider: Provider;
  t: Translate;
  tokenUsage?: ProviderTokenUsageTotals;
}

function apiBalanceLabel(balance: ProviderBalance, t: Translate, amountLabel: CurrencyFormatter) {
  if (balance.apiUnlimited) return t("providers.balance.unlimited");
  if (balance.apiAmount == null) return null;
  return amountLabel(balance.apiAmount, balance.apiUnit);
}

function tokenLabel(value: number | undefined, language: Language) {
  return value == null ? "--" : formatCompactTokenCount(value, language);
}

function balanceLabel(options: Pick<FloatingProviderCardProps,
  "balance" | "balanceError" | "loading" | "provider" | "t">, amountLabel: CurrencyFormatter) {
  const { balance, balanceError, loading, provider, t } = options;
  if (!provider.balancePlatform) return t("providers.balance.notConfigured");
  if (loading && !balance) return t("providers.balance.loading");
  if (balanceError) return t("providers.balance.failed");
  if (!balance) return "--";
  if (balance.apiUnlimited && provider.balancePlatform === "deepSeek") {
    return t("providers.balance.unavailable");
  }
  if (balance.balanceItems?.length) {
    return balance.balanceItems.map((item) => amountLabel(item.amount, item.unit)).join(" · ");
  }
  const amounts = [
    apiBalanceLabel(balance, t, amountLabel),
    balance.walletAmount == null ? null : amountLabel(balance.walletAmount, balance.walletUnit),
  ].filter((value): value is string => value !== null);
  return amounts.join(" · ") || "--";
}

export function FloatingProviderCard(props: FloatingProviderCardProps) {
  const formatAmount = useCurrencyFormatter();
  const { language, provider, t, tokenUsage } = props;
  const balance = balanceLabel(props, formatAmount);
  return <span className="floating-provider-details">
    <span className="floating-provider-heading">
      <b title={provider.name}>{provider.name}</b>
      <strong title={provider.model}>{provider.model}</strong>
    </span>
    <span><b>{t("providers.table.balance")}</b><strong title={balance}>{balance}</strong></span>
    <span><b>{t("providers.table.todayTokens")}</b>
      <strong>{tokenLabel(tokenUsage?.todayTokens, language)}</strong></span>
    <span><b>{t("providers.table.totalTokens")}</b>
      <strong>{tokenLabel(tokenUsage?.totalTokens, language)}</strong></span>
  </span>;
}
