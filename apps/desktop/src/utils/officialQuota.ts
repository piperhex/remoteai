import type { OfficialAccountTotal } from '../../../../shared/officialUsage';
import { accountQuota } from '../../../../shared/token-usage/officialUsageChartData';
import {
  DEFAULT_TOKEN_COST_DISPLAY_SETTINGS,
  formatEstimatedCostValue,
  type TokenCostDisplaySettings,
} from './tokenCost';

function formatQuotaAmount(value: number, settings: TokenCostDisplaySettings) {
  return String(Number(formatEstimatedCostValue(value, settings)));
}

export function formatAvailableQuota(
  account: OfficialAccountTotal | undefined,
  settings = DEFAULT_TOKEN_COST_DISPLAY_SETTINGS,
): string | null {
  if (account?.remainingUsd == null) return null;
  const quota = accountQuota(account);
  const remaining = formatQuotaAmount(account.remainingUsd, settings);
  const capacity = quota?.capacityUsd == null ? '—' : formatQuotaAmount(quota.capacityUsd, settings);
  return `${remaining} / ${capacity}${settings.unit}`;
}
