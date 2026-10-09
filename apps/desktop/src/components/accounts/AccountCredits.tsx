import { Button, Space, Tooltip } from "antd";
import { RefreshCw } from "lucide-react";
import { getLocale, type Language, type Translate } from "../../i18n";
import type { CreditsSnapshot } from "../../types";

export function AccountCreditsTitle({ refreshing, onRefresh, t }: {
  refreshing: boolean;
  onRefresh: () => void;
  t: Translate;
}) {
  return <Space size={4}>
    {t("table.credits")}
    <Tooltip title={t("table.refreshCredits")} styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" size="small" className="table-icon-button" loading={refreshing}
        disabled={refreshing} aria-label={t("table.refreshCredits")}
        icon={<RefreshCw size={13} />} onClick={(event) => { event.stopPropagation(); onRefresh(); }} />
    </Tooltip>
  </Space>;
}

export function AccountCredits({ credits, language, t }: {
  credits: CreditsSnapshot | null | undefined;
  language: Language;
  t: Translate;
}) {
  let label = "—";
  if (credits?.unlimited) label = t("table.creditsUnlimited");
  else if (credits) {
    const balance = credits.balance?.trim();
    const amount = balance ? Number(balance) : NaN;
    if (Number.isFinite(amount) && amount >= 0) {
      label = new Intl.NumberFormat(getLocale(language), { maximumFractionDigits: 3 }).format(amount);
    } else if (!credits.hasCredits) label = "0";
  }
  return <Tooltip title={label === "—" ? t("table.creditsUnknown") : t("table.creditsHint")}
    styles={{ root: { maxWidth: 400 } }}>
    <span className="account-credits" style={{ fontVariantNumeric: "tabular-nums" }}>{label}</span>
  </Tooltip>;
}
