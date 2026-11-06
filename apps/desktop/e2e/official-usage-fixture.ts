import type { OfficialUsageSummary } from '../../../shared/officialUsage';

export function officialUsageFixture(): OfficialUsageSummary {
  const now = Math.floor(Date.now() / 1000);
  const primary = { capacityUsd: 30, remainingUsd: 18, consumedUsd: 6, declinePercent: 20,
    startPercent: 80, remainingPercent: 60, startTs: now - 200, endTs: now - 50 };
  return { status: 'ready', updatedAt: now, accounts: [
    { accountId: 'personal', accountLabel: 'alex.chen@example.com', tokens: 12000000, costUsd: 24,
      remainingUsd: 18, primary, secondary: { ...primary, capacityUsd: 100, remainingUsd: 50 },
      devices: [
        { deviceId: 'office', deviceName: 'Office PC', tokens: 7000000, costUsd: 10, updatedAt: now },
        { deviceId: 'laptop', deviceName: 'Laptop', tokens: 3000000, costUsd: 8, updatedAt: now },
        { deviceId: 'home', deviceName: 'Home PC', tokens: 2000000, costUsd: 6, updatedAt: now },
      ] },
    { accountId: 'work', accountLabel: 'studio@example.com', tokens: 3000000, costUsd: 40,
      remainingUsd: 0, primary: { ...primary, capacityUsd: 20, remainingUsd: 0 }, secondary: null,
      devices: [{ deviceId: 'office', deviceName: 'Office PC', tokens: 3000000, costUsd: 40, updatedAt: now }] },
    { accountId: 'new', accountLabel: 'new.account@example.com', tokens: 210000, costUsd: 1.14,
      remainingUsd: null, primary: null, secondary: null,
      devices: [{ deviceId: 'laptop', deviceName: 'Laptop', tokens: 210000, costUsd: 1.14, updatedAt: now }] },
    { accountId: 'empty', accountLabel: 'unused@example.com', tokens: 0, costUsd: 0,
      remainingUsd: null, primary: null, secondary: null, devices: [] },
  ] };
}
