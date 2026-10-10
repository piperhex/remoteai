import { Tooltip } from "antd";
import { Database, Wallet } from "lucide-react";
import type { Language, Translate } from "../../i18n";
import { formatCompactTokenCount } from "../../utils/tokenContext";
import { formatEstimatedCost, type TokenCostDisplaySettings } from "../../utils/tokenCost";
import { DailyTokenUsageTooltip } from "../DailyTokenUsageTooltip";
import { accountCardLabels } from "./accountCardLabels";
import type { AccountCardTokenUsage } from "./accountCardUsage";

export function AccountCardFooter({ usage, display, language, t }: {
  usage: AccountCardTokenUsage;
  display: TokenCostDisplaySettings;
  language: Language;
  t: Translate;
}) {
  return <footer className="account-card-token-footer">
    <Tooltip title={<DailyTokenUsageTooltip totals={usage.totals} language={language} />}
      placement="topLeft" styles={{ root: { maxWidth: 400 } }}>
      <span className="account-card-token-summary" aria-label={t("table.tokenTotals")}>
        <Database size={16} aria-hidden="true" />
        <span>{accountCardLabels(language).today}{" "}
          <strong>{formatCompactTokenCount(usage.totals.total, language)} Tokens</strong>
        </span>
      </span>
    </Tooltip>
    <Tooltip title={t("table.estimatedTokenCostHint", { unit: display.unit })}
      styles={{ root: { maxWidth: 400 } }}>
      <span className="account-card-token-cost">
        <Wallet size={16} aria-hidden="true" />
        <span>{formatEstimatedCost(usage.estimatedCost, display)}</span>
      </span>
    </Tooltip>
  </footer>;
}
