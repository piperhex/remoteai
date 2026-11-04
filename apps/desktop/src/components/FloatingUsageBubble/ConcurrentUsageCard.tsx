import COPYResource from '@remoteai/i18n/copy/desktop/concurrentUsage';
import type { Language } from "../../i18n";
import { formatEstimatedCost, type TokenCostDisplaySettings } from "../../utils/tokenCost";
import { formatCompactTokenCount } from "../../../../../shared/context-usage/format";
import type { ConcurrentUsageSummary } from "./concurrentUsageSummary";

const COPY = COPYResource;

export function ConcurrentUsageCard({
  display,
  language,
  summary,
}: {
  display: TokenCostDisplaySettings;
  language: Language;
  summary: ConcurrentUsageSummary;
}) {
  const copy = COPY[language];
  return <span className="floating-concurrent-details">
    <span className="floating-concurrent-heading">
      <strong>{copy.title}</strong>
      <i aria-hidden="true" />
    </span>
    <span className="floating-concurrent-stats">
      <span>
        <small>{copy.totalTokens}</small>
        <strong>{formatCompactTokenCount(summary.totalTokens, language)}</strong>
      </span>
      <span>
        <small>{copy.estimatedCost}</small>
        <strong>{formatEstimatedCost(summary.estimatedCost, display)}</strong>
      </span>
      <span>
        <small>{copy.accountCount}</small>
        <strong>{summary.accountCount}</strong>
      </span>
    </span>
  </span>;
}
