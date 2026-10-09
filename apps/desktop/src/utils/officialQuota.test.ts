import { expect, it } from 'vitest';
import type { OfficialAccountTotal, QuotaEstimate } from '../../../../shared/officialUsage';
import { formatAvailableQuota } from './officialQuota';

function quota(remainingUsd: number | null, capacityUsd: number | null): QuotaEstimate {
  return { remainingUsd, capacityUsd, consumedUsd: 10, declinePercent: 10,
    startPercent: 20, remainingPercent: 10, startTs: 0, endTs: 1 };
}

function account(overrides: Partial<OfficialAccountTotal> = {}): OfficialAccountTotal {
  return { accountId: 'official', accountLabel: 'Example', tokens: 200, costUsd: 10,
    remainingUsd: 50, primary: quota(50, 500), secondary: null, devices: [], ...overrides };
}

it('shows remaining and total quota with a single unit and no trailing decimal zeroes', () => {
  expect(formatAvailableQuota(account())).toBe('50/500USD');
  expect(formatAvailableQuota(account({ remainingUsd: 50.25, primary: quota(50.25, 500.5) })))
    .toBe('50.25/500.5USD');
});

it('pairs the remaining amount with the same quota window, including ties and exhausted quotas', () => {
  expect(formatAvailableQuota(account({ secondary: quota(100, 200) }))).toBe('50/500USD');
  expect(formatAvailableQuota(account({ primary: quota(100, 200), secondary: quota(50, 500) })))
    .toBe('50/500USD');
  expect(formatAvailableQuota(account({ secondary: quota(50, 1000) }))).toBe('50/500USD');
  expect(formatAvailableQuota(account({ remainingUsd: 0, secondary: quota(0, 1000) }))).toBe('0/1000USD');
});

it('converts both amounts to the selected unit and keeps precision for small amounts', () => {
  expect(formatAvailableQuota(account(), { unit: '元', usdMultiplier: 7, currencyCode: 'CNY' }))
    .toBe('350/3500元');
  expect(formatAvailableQuota(account({ remainingUsd: 0.005, primary: quota(0.005, 0.05) })))
    .toBe('0.005/0.05USD');
});

it('preserves unknown estimates without borrowing a total from a different quota window', () => {
  expect(formatAvailableQuota(undefined)).toBeNull();
  expect(formatAvailableQuota(account({ remainingUsd: null }))).toBeNull();
  expect(formatAvailableQuota(account({ primary: null }))).toBe('50/—USD');
  expect(formatAvailableQuota(account({ primary: quota(50, null), secondary: quota(100, 500) })))
    .toBe('50/—USD');
  expect(formatAvailableQuota(account({ remainingUsd: 0, primary: quota(0, null), secondary: quota(100, 500) })))
    .toBe('0/—USD');
});
