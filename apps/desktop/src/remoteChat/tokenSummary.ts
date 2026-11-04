import { loadAppSettings } from '../api/backend';
import { readDashboardQuery } from '../components/TokenUsageDashboard/dashboardQuery';
import { aggregateEntries, calendarDateKeys, startOfCalendar } from '../../../../shared/token-usage/chartUtils';
import { loadLongContextCostSettings } from '../utils/tokenCostLongContext';
import { MAX_SUMMARY_WEEKS, MIN_SUMMARY_WEEKS, type TokenSummary } from '../../../../shared/remote-chat/tokenSummary';
import { loadOfficialUsage } from '../api/officialUsage';
import { uiText } from "../../../../shared/localization/uiText";

const DEFAULT_WEEKS = 10;
const DEFAULT_REFRESH_SECONDS = 60;

export async function readTokenSummary(requestedWeeks: unknown): Promise<TokenSummary> {
  if (requestedWeeks !== undefined && (typeof requestedWeeks !== 'number'
    || !Number.isInteger(requestedWeeks) || requestedWeeks < MIN_SUMMARY_WEEKS
    || requestedWeeks > MAX_SUMMARY_WEEKS)) throw new Error('请选择 1 至 52 周。');
  const settings = await loadAppSettings();
  const weeks = requestedWeeks as number | undefined ?? settings.tokenUsageWeeks ?? DEFAULT_WEEKS;
  const thresholdTokens = loadLongContextCostSettings().thresholdTokens;
  const startTs = Math.floor(startOfCalendar(weeks).getTime() / 1000);
  const [usage, official] = await Promise.all([
    readDashboardQuery({ startTs, thresholdTokens, maxAgeMs: 0 }),
    loadOfficialUsage(startTs).catch(() => null),
  ]);
  const recent = usage.entries;
  const endTs = usage.endTs;
  return {
    weeks, refreshSeconds: settings.tokenUsageRefreshSeconds ?? DEFAULT_REFRESH_SECONDS,
    thresholdTokens, startTs, endTs, dateKeys: calendarDateKeys(weeks),
    dailyUsage: usage.dailyUsage,
    breakdown: usage.breakdown,
    quotaHistory: usage.quotaHistory,
    officialUsage: official ?? { accounts: [], status: 'unavailable', updatedAt: endTs },
    rankings: {
      providers: aggregateEntries(recent, (entry) => entry.provider),
      models: aggregateEntries(recent, (entry) => entry.model),
      accounts: aggregateEntries(recent, (entry) => entry.accountEmail?.trim()
        || entry.accountId?.trim() || uiText("client.usage.unidentifiedAccount")),
    },
    entryCount: recent.length,
    errors: { usage: usage.error, analytics: usage.analyticsError, quota: usage.quotaError },
  };
}
