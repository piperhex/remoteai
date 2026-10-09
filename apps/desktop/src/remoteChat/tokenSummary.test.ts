// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import * as backend from '../api/backend';
import { readTokenSummary } from './tokenSummary';
import { loadOfficialUsage } from '../api/officialUsage';
import { ChatOperations } from './operations';
import { LONG_CONTEXT_COST_STORAGE_KEY, DEFAULT_LONG_CONTEXT_COST_SETTINGS } from '../utils/tokenCostLongContext';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { QUOTA_HISTORY_FORMAT } from '../../../../shared/remote-chat/tokenSummaryCodec';
import type { RpcRequest } from '../../../../shared/remote-chat/protocol';

vi.mock('../api/backend', () => ({ loadAppSettings: vi.fn(), loadTokenUsageEntries: vi.fn(),
  loadDailyTokenUsage: vi.fn(), loadTokenUsageBreakdown: vi.fn(), loadAccountQuotaHistory: vi.fn(), invoke: vi.fn() }));
vi.mock('../api/officialUsage', () => ({ loadOfficialUsage: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(backend.loadAppSettings).mockResolvedValue({ tokenUsageWeeks: 4, tokenUsageRefreshSeconds: 30,
    floatingBubbleEnabled: false, privacyMode: false, hideAccountNotes: false,
    bubbleResetDisplay: 'countdown', bubbleStyle: 'classic' });
  vi.mocked(backend.loadTokenUsageEntries).mockResolvedValue([
    { id: 'one', ts: 1, provider: 'Work', model: 'model', accountEmail: 'me@example.test', totalTokens: 100 },
    { id: 'two', ts: 2, provider: 'Work', model: 'model', accountId: 'account', inputTokens: 20, outputTokens: 30 },
  ]);
  vi.mocked(backend.loadDailyTokenUsage).mockResolvedValue([]);
  vi.mocked(backend.loadTokenUsageBreakdown).mockResolvedValue([]);
  vi.mocked(backend.loadAccountQuotaHistory).mockResolvedValue([]);
  vi.mocked(loadOfficialUsage).mockResolvedValue({ accounts: [], status: 'signedOut', updatedAt: 0 });
});

it('forwards the server estimate and range to remote clients without recalculating it', async () => {
  const official = { status: 'ready' as const, updatedAt: 123, accounts: [{
    accountId: 'official', accountLabel: 'Official account', tokens: 300, costUsd: 6, remainingUsd: 18,
    primary: { capacityUsd: 30, remainingUsd: 18, consumedUsd: 6, declinePercent: 20,
      startPercent: 80, remainingPercent: 60, startTs: 100, endTs: 200 }, secondary: null, devices: [],
  }] };
  vi.mocked(loadOfficialUsage).mockResolvedValue(official);
  const summary = await readTokenSummary(4);
  expect(loadOfficialUsage).toHaveBeenCalledWith(summary.startTs);
  expect(summary.officialUsage).toEqual(official);
});

it('uses PC preferences, threshold, range and ranking semantics through remote RPC', async () => {
  localStorage.setItem(LONG_CONTEXT_COST_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_LONG_CONTEXT_COST_SETTINGS, thresholdTokens: 128000,
  }));
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, id: 'summary', method: 'request' as const,
    body: { operation: 'tokenSummary' } };
  const response = await operations.execute(request);
  expect(response.error).toBeUndefined();
  expect(response.data).toMatchObject({ weeks: 4, refreshSeconds: 30, thresholdTokens: 128000,
    entryCount: 2, rankings: { providers: [['Work', 150]], models: [['model', 150]],
      accounts: [['me@example.test', 100], ['account', 50]] },
    errors: { usage: false, analytics: false, quota: false } });
  expect(backend.loadTokenUsageEntries).toHaveBeenCalledWith();
  expect(backend.loadTokenUsageBreakdown).toHaveBeenCalledWith(expect.any(Number), 128000);
  expect(await operations.execute(request)).toEqual(response);
  expect(backend.loadTokenUsageEntries).toHaveBeenCalledTimes(1);
});

it.each([null, 0, 53, 1.5, '4', {}, Number.NaN])('rejects invalid range %j before loading', async (weeks) => {
  await expect(readTokenSummary(weeks)).rejects.toThrow('请选择');
  expect(backend.loadAppSettings).not.toHaveBeenCalled();
});

it('allows a phone range without changing PC preferences and retains successful sections on partial failure', async () => {
  vi.mocked(backend.loadTokenUsageBreakdown).mockRejectedValue(new Error('private path'));
  const summary = await readTokenSummary(1);
  expect(summary.weeks).toBe(1);
  expect(summary.dateKeys.length).toBeLessThanOrEqual(7);
  expect(summary.rankings.providers).toEqual([['Work', 150]]);
  expect(summary.errors).toEqual({ usage: false, analytics: true, quota: false });
  expect(JSON.stringify(summary)).not.toContain('private path');
});

it.each([false, true])('loads unchanged charts through the phone controller (legacy desktop: %s)', async (legacy) => {
  const quotaHistory = [{ accountId: 'account', accountLabel: '账户', points: [
    { ts: 100, primaryRemainingPercent: 80, secondaryRemainingPercent: null,
      primaryResetAt: 1000, secondaryResetAt: null },
    { ts: 105, primaryRemainingPercent: 80, secondaryRemainingPercent: null,
      primaryResetAt: 1000, secondaryResetAt: null },
  ] }];
  vi.mocked(backend.loadAccountQuotaHistory).mockResolvedValue(quotaHistory);
  const operations = new ChatOperations();
  const request = vi.fn(async (method: RpcRequest['method'], body?: unknown) => {
    const response = await operations.execute({ kind: 'request', id: 'phone-summary', method,
      body: legacy ? { operation: 'tokenSummary', weeks: 1 } : body });
    expect(response.error).toBeUndefined();
    expect(response.data).toMatchObject(legacy ? { quotaHistory } : { quotaHistoryFormat: QUOTA_HISTORY_FORMAT });
    return response.data;
  });
  const controller = new ChatController(() => ({
    request: <T>(method: RpcRequest['method'], body?: unknown) => request(method, body) as Promise<T>,
    start() {}, stop() {},
  }));
  const summary = await controller.readTokenSummary(1);
  expect(request).toHaveBeenCalledWith('request', {
    operation: 'tokenSummary', weeks: 1, quotaHistoryFormat: QUOTA_HISTORY_FORMAT,
  });
  expect(summary.quotaHistory).toEqual(quotaHistory);
  expect(summary.weeks).toBe(1);
  expect(summary).not.toHaveProperty('quotaHistoryFormat');
});

it('keeps legacy responses for clients without a supported history format', async () => {
  const response = await new ChatOperations().execute({ kind: 'request', id: 'legacy-summary', method: 'request',
    body: { operation: 'tokenSummary', quotaHistoryFormat: 'future-format' } });
  expect(response.error).toBeUndefined();
  expect(response.data).toHaveProperty('quotaHistory', []);
  expect(response.data).not.toHaveProperty('quotaHistoryFormat');
});
