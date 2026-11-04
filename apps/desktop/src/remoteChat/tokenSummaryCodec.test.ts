import { expect, it } from 'vitest';
import type { AccountQuotaPoint } from '../../../../shared/token-usage/analytics';
import type { TokenSummary } from '../../../../shared/remote-chat/tokenSummary';
import { decodeTokenSummary, encodeTokenSummary } from '../../../../shared/remote-chat/tokenSummaryCodec';
import { chunks, Assembler } from '../../../../shared/remote-chat/framing';

function snapshot(points: AccountQuotaPoint[]): TokenSummary {
  return { weeks: 20, refreshSeconds: 60, thresholdTokens: 128000,
    startTs: 100, endTs: 1000000, dateKeys: [], dailyUsage: [], breakdown: [],
    quotaHistory: [{ accountId: 'account', accountLabel: '账户', points },
      { accountId: 'empty', accountLabel: '暂无记录', points: [] }],
    rankings: { providers: [['Work', 100]], models: [], accounts: [] }, entryCount: 1,
    errors: { usage: false, analytics: false, quota: false } };
}

const point = (ts: number, patch: Partial<AccountQuotaPoint> = {}): AccountQuotaPoint => ({
  ts, primaryRemainingPercent: 83.125, secondaryRemainingPercent: 45.75,
  primaryResetAt: 1000, secondaryResetAt: 2000, ...patch,
});

it('preserves every observation, gap, quota reset, missing value and account through JSON and framing', () => {
  const original = snapshot([
    point(99), point(100), point(102), point(106), point(8000),
    point(8001, { primaryRemainingPercent: 80 }),
    point(8002, { primaryRemainingPercent: 80, primaryResetAt: 9000 }),
    point(8003, { secondaryRemainingPercent: null, secondaryResetAt: null }),
    point(8004, { primaryRemainingPercent: 0, secondaryRemainingPercent: 100 }),
    point(8005), point(8005), point(8006),
  ]);
  const before = JSON.stringify(original);
  const encoded = encodeTokenSummary(original);
  const assembler = new Assembler();
  let response;
  for (const frame of chunks({ kind: 'response', id: 'summary', data: encoded }, 'summary')) {
    response = assembler.accept(frame);
  }
  expect(response).toMatchObject({ kind: 'response', id: 'summary' });
  if (response?.kind !== 'response') throw new Error('Missing summary response');
  expect(decodeTokenSummary(response.data as typeof encoded)).toEqual(original);
  expect(JSON.stringify(original)).toBe(before);
});

it('keeps frequent multi-account observations below one tenth of the original transfer size', () => {
  const observations = Array.from({ length: 120000 }, (_, index) => point(100 + index * 5, {
    primaryRemainingPercent: 100 - Math.floor(index / 120) % 100,
    primaryResetAt: 1000000 + Math.floor(index / 1000) * 1000,
  }));
  const original = snapshot(observations);
  const encoded = encodeTokenSummary(original);
  expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(original).length / 10);
  const decoded = decodeTokenSummary(JSON.parse(JSON.stringify(encoded)) as typeof encoded);
  expect(decoded.quotaHistory).toEqual(original.quotaHistory);
  expect(decoded.quotaHistory[0].points).toHaveLength(120000);
});

it('accepts summaries from desktops that do not support compact histories', () => {
  const original = snapshot([point(100)]);
  expect(decodeTokenSummary(original)).toBe(original);
});
