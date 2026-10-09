import type { OfficialAccountTotal } from '../../../../shared/officialUsage';
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
  // Match the limiting window selected by the server so both amounts describe the same quota.
  const quota = [account.primary, account.secondary].find((item) => item?.remainingUsd === account.remainingUsd);
  const remaining = formatQuotaAmount(account.remainingUsd, settings);
  const capacity = quota?.capacityUsd == null ? '—' : formatQuotaAmount(quota.capacityUsd, settings);
  return `${remaining}/${capacity}${settings.unit}`;
}
