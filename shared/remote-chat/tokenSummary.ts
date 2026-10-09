import type { DailyTokenUsage } from '../../apps/desktop/src/types';
import type { OfficialUsageSummary } from '../officialUsage';
import type { AccountQuotaHistory, DailyTokenUsageBreakdown } from
  '../../apps/desktop/src/types/tokenUsageAnalytics';

export const TOKEN_SUMMARY_OPERATION = 'tokenSummary';
export const MIN_SUMMARY_WEEKS = 1;
export const MAX_SUMMARY_WEEKS = 52;
export type UsageRanking = Array<[string, number]>;

export interface TokenSummary {
  weeks: number;
  refreshSeconds: number;
  thresholdTokens: number;
  startTs: number;
  endTs: number;
  dateKeys: string[];
  dailyUsage: DailyTokenUsage[];
  breakdown: DailyTokenUsageBreakdown[];
  quotaHistory: AccountQuotaHistory[];
  officialUsage?: OfficialUsageSummary;
  rankings: { providers: UsageRanking; models: UsageRanking; accounts: UsageRanking };
  entryCount: number;
  errors: { usage: boolean; analytics: boolean; quota: boolean };
}

export type ReadTokenSummary = (weeks?: number) => Promise<TokenSummary>;
