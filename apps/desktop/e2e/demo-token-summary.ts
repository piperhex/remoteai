import type { TokenSummary } from '../../../shared/remote-chat/tokenSummary';
import { calendarDateKeys, startOfCalendar } from '../../../shared/token-usage/chartUtils';

export function demoTokenSummary(input: Record<string, unknown>): TokenSummary {
  const weeks = typeof input.weeks === 'number' ? input.weeks : 4;
  const dateKeys = calendarDateKeys(weeks);
  const endTs = Math.floor(Date.now() / 1000);
  return {
    weeks, refreshSeconds: 2, thresholdTokens: 128000,
    startTs: Math.floor(startOfCalendar(weeks).getTime() / 1000), endTs, dateKeys,
    dailyUsage: dateKeys.map((date, index) => ({ date, totalTokens: (index + 1) * 1000000,
      inputTokens: (index + 1) * 800000, outputTokens: (index + 1) * 200000,
      reasoningTokens: (index + 1) * 100000, cachedTokens: (index + 1) * 600000 })),
    breakdown: dateKeys.map((date) => ({ date, shortContextTokens: 100000, longContextTokens: 200000,
      unknownContextTokens: 0, standardModeTokens: 200000, fastModeTokens: 100000, unknownModeTokens: 0 })),
    quotaHistory: [{ accountId: 'demo', accountLabel: '演示账户一', points: [
      { ts: endTs - 3600, primaryRemainingPercent: 90, secondaryRemainingPercent: 80,
        primaryResetAt: null, secondaryResetAt: null },
      { ts: endTs, primaryRemainingPercent: 85, secondaryRemainingPercent: 78,
        primaryResetAt: null, secondaryResetAt: null },
    ] }],
    rankings: { providers: [['演示 Provider', 300000]], models: [['演示模型', 300000]],
      accounts: [['演示账户一', 300000]] },
    entryCount: 12, errors: { usage: false, analytics: false, quota: false },
  };
}
