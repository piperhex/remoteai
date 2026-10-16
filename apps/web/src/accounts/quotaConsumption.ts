import { apiJson, getActiveSession } from '../api';
import type { UsageSummary } from '../types';

const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 130_000;
const USAGE_TIMEOUT_MS = 30_000;

export interface QuotaProgress { done: number; total: number }
export interface QuotaResult {
  success: number;
  failed: number;
  skipped: number;
  refreshFailed: number;
  usage: Array<{ accountId: string; usage: UsageSummary }>;
}

function currentOwner() {
  const session = getActiveSession();
  return session ? `${session.baseUrl}\n${session.email}` : null;
}

async function consumeOne(accountId: string, requestId: string, owner: string, result: QuotaResult) {
  if (currentOwner() !== owner) throw new Error('登录状态已改变，已停止消耗');
  try {
    const response = await apiJson<{ consumed: boolean; skipped: boolean }>(
      `/sync/accounts/${encodeURIComponent(accountId)}/quota/consume`, {
        method: 'POST', body: JSON.stringify({ requestId }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    if (response.consumed) result.success++;
    else if (response.skipped) result.skipped++;
    else result.failed++;
  } catch { result.failed++; }
  if (currentOwner() !== owner) throw new Error('登录状态已改变，已停止消耗');
  // Even a failed/timeout response may have consumed quota. Query usage without replaying generation.
  try {
    const usage = await apiJson<UsageSummary>(`/sync/accounts/${encodeURIComponent(accountId)}/usage`,
      { signal: AbortSignal.timeout(USAGE_TIMEOUT_MS) });
    if (usage.error) result.refreshFailed++;
    result.usage.push({ accountId, usage });
  } catch { result.refreshFailed++; }
}

export async function consumeAccountsQuota(accountIds: string[], onProgress: (value: QuotaProgress) => void) {
  const ids = [...new Set(accountIds)];
  const owner = currentOwner();
  if (!owner) throw new Error('请先登录');
  const requestId = crypto.randomUUID();
  const result: QuotaResult = { success: 0, failed: 0, skipped: 0, refreshFailed: 0, usage: [] };
  let cursor = 0;
  let done = 0;
  let stopped = false;
  onProgress({ done, total: ids.length });
  async function worker() {
    while (cursor < ids.length && !stopped) {
      const id = ids[cursor++];
      try { await consumeOne(id, requestId, owner!, result); }
      catch { stopped = true; }
      done++;
      onProgress({ done, total: ids.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  if (stopped || currentOwner() !== owner) throw new Error('登录状态已改变，已停止消耗');
  return result;
}
