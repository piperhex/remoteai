import { expect, it } from 'vitest';
import { accountQuota, quotaPercent, usageMaximum } from '../../../../../shared/token-usage/officialUsageChartData';
import type { OfficialAccountTotal, QuotaEstimate } from '../../../../../shared/officialUsage';

const quota = (remainingUsd: number, capacityUsd: number | null): QuotaEstimate => ({
  remainingUsd, capacityUsd, consumedUsd: 10, declinePercent: 10, startPercent: 70,
  remainingPercent: 60, startTs: 0, endTs: 1,
});
const account = (overrides: Partial<OfficialAccountTotal> = {}): OfficialAccountTotal => ({
  accountId: 'example', accountLabel: 'Example', remainingUsd: 18, primary: quota(18, 30),
  secondary: quota(20, 100), tokens: 200, costUsd: 10, devices: [], ...overrides,
});

it('uses the server-selected limiting window for the remaining quota chart', () => {
  expect(quotaPercent(account())).toBe(60);
  const secondary = account({ remainingUsd: 20 });
  expect(accountQuota(secondary)).toBe(secondary.secondary);
  expect(quotaPercent(secondary)).toBe(20);
  expect(quotaPercent(account({ remainingUsd: 0, primary: quota(0, 30) }))).toBe(0);
});

it('distinguishes unknown quota from exhausted quota and clamps the chart range', () => {
  for (const value of [account({ remainingUsd: null }), account({ primary: null }),
    account({ primary: quota(18, null) }), account({ primary: quota(18, 0) })]) {
    expect(quotaPercent(value)).toBeNull();
  }
  expect(quotaPercent(account({ primary: quota(18, 10) }))).toBe(100);
});

it('compares accounts on one scale for each metric and handles all-zero usage', () => {
  const accounts = [account(), account({ tokens: 2000, costUsd: 1 })];
  expect(usageMaximum(accounts, 'tokens')).toBe(2000);
  expect(usageMaximum(accounts, 'costUsd')).toBe(10);
  expect(usageMaximum([account({ tokens: 0 })], 'tokens')).toBe(1);
  expect(usageMaximum([], 'tokens')).toBe(1);
});
