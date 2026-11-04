import type { DailyTokenUsage } from "../types";
import type { AccountQuotaHistory, DailyTokenUsageBreakdown } from "../../../../shared/token-usage/analytics";

export function previewTokenBreakdown(daily: DailyTokenUsage[]): DailyTokenUsageBreakdown[] {
  return daily.map((entry, index) => {
    const long = Math.floor(entry.totalTokens * ((index % 5 + 1) / 10));
    const fast = Math.floor(entry.totalTokens * ((index % 3 + 1) / 10));
    const unknown = Math.floor(entry.totalTokens * .05);
    return {
      date: entry.date,
      shortContextTokens: entry.totalTokens - long - unknown,
      longContextTokens: long,
      unknownContextTokens: unknown,
      standardModeTokens: entry.totalTokens - fast - unknown,
      fastModeTokens: fast,
      unknownModeTokens: unknown,
    };
  });
}

export function previewAccountQuotaHistory(startTs: number, endTs: number): AccountQuotaHistory[] {
  const hour = 3600;
  const start = Math.max(startTs, endTs - 3 * 24 * hour);
  return ["alex.chen@example.com", "work@example.com"].map((accountLabel, accountIndex) => {
    const points = [];
    for (let ts = start, index = 0; ts <= endTs; ts += hour, index += 1) {
      points.push({
        ts,
        primaryRemainingPercent: 100 - (index % 5) * (12 + accountIndex * 3),
        secondaryRemainingPercent: Math.max(0, 95 - index * (1 + accountIndex * .2)),
        primaryResetAt: start + (Math.floor(index / 5) + 1) * 5 * hour,
        secondaryResetAt: endTs + 4 * 24 * hour,
      });
    }
    return { accountId: `preview-quota-${accountIndex}`, accountLabel, points };
  });
}
