import {
  loadAppSettings, loadAccountQuotaHistory, loadDailyTokenUsage, loadTokenUsageBreakdown, loadTokenUsageEntries,
} from '../api/backend';
import { aggregateEntries, calendarDateKeys, startOfCalendar } from '../components/TokenUsageDashboard/chartUtils';
import { loadLongContextCostSettings } from '../utils/tokenCostLongContext';
import { MAX_SUMMARY_WEEKS, MIN_SUMMARY_WEEKS, type TokenSummary } from '../../../../shared/remote-chat/tokenSummary';
import { loadOfficialUsage } from '../api/officialUsage';

const DEFAULT_WEEKS = 20;
const DEFAULT_REFRESH_SECONDS = 60;

export async function readTokenSummary(requestedWeeks: unknown): Promise<TokenSummary> {
  if (requestedWeeks !== undefined && (typeof requestedWeeks !== 'number'
    || !Number.isInteger(requestedWeeks) || requestedWeeks < MIN_SUMMARY_WEEKS
    || requestedWeeks > MAX_SUMMARY_WEEKS)) throw new Error('请选择 1 至 52 周。');
  const settings = await loadAppSettings();
  const weeks = requestedWeeks as number | undefined ?? settings.tokenUsageWeeks ?? DEFAULT_WEEKS;
  const thresholdTokens = loadLongContextCostSettings().thresholdTokens;
  const startTs = Math.floor(startOfCalendar(weeks).getTime() / 1000);
  const endTs = Math.floor(Date.now() / 1000);
  const [entries, daily, breakdown, quota, official] = await Promise.allSettled([
    loadTokenUsageEntries(), loadDailyTokenUsage(startTs),
    loadTokenUsageBreakdown(startTs, thresholdTokens), loadAccountQuotaHistory(startTs, endTs),
    loadOfficialUsage(startTs),
  ]);
  const recent = entries.status === 'fulfilled' ? entries.value : [];
  return {
    weeks, refreshSeconds: settings.tokenUsageRefreshSeconds ?? DEFAULT_REFRESH_SECONDS,
    thresholdTokens, startTs, endTs, dateKeys: calendarDateKeys(weeks),
    dailyUsage: daily.status === 'fulfilled' ? daily.value : [],
    breakdown: breakdown.status === 'fulfilled' ? breakdown.value : [],
    quotaHistory: quota.status === 'fulfilled' ? quota.value : [],
    officialUsage: official.status === 'fulfilled'
      ? official.value
      : { accounts: [], status: 'unavailable', updatedAt: endTs },
    rankings: {
      providers: aggregateEntries(recent, (entry) => entry.provider),
      models: aggregateEntries(recent, (entry) => entry.model),
      accounts: aggregateEntries(recent, (entry) => entry.accountEmail?.trim()
        || entry.accountId?.trim() || '未识别账户'),
    },
    entryCount: recent.length,
    errors: { usage: entries.status === 'rejected' || daily.status === 'rejected',
      analytics: breakdown.status === 'rejected', quota: quota.status === 'rejected' },
  };
}
