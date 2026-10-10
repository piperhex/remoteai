export const CONVERSATION_METRICS_OPERATION = 'conversationMetrics';
export const CONVERSATION_METRICS_REFRESH_MS = 2_000;

export interface ConversationMetrics {
  /** Older remote hosts may not report first-token timing yet. */
  totalFirstTokenTimeMs?: number;
  firstTokenRequestCount?: number;
  totalOutputTokens: number;
  totalOutputTimeMs: number;
  outputRequestCount: number;
}

export type ReadConversationMetrics = (threadId: string) => Promise<ConversationMetrics>;

/** Match the account-page average: output tokens divided by time after the first response. */
export function formatConversationTps(metrics?: ConversationMetrics | null): string {
  if (!metrics || !(metrics.outputRequestCount > 0) || !(metrics.totalOutputTimeMs > 0)
    || !Number.isFinite(metrics.totalOutputTimeMs) || !Number.isFinite(metrics.totalOutputTokens)
    || metrics.totalOutputTokens < 0) return '—';
  const tps = metrics.totalOutputTokens / metrics.totalOutputTimeMs * 1_000;
  return Number.isFinite(tps) ? tps.toFixed(1) : '—';
}

export const CONVERSATION_TPS_DESCRIPTION =
  '当前对话的平均输出速度：已完成请求的输出 token 数 ÷ 输出耗时，不含首次响应前的等待和中断请求。';

/** Average wait for the first observed output token, in seconds without a unit suffix. */
export function formatConversationTtft(metrics?: ConversationMetrics | null): string {
  const total = metrics?.totalFirstTokenTimeMs;
  const count = metrics?.firstTokenRequestCount;
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0
    || typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) return '—';
  return (total / count / 1_000).toFixed(2);
}

export const CONVERSATION_TTFT_DESCRIPTION =
  '当前对话的平均首 token 等待时间：从请求发出到收到首段文字、思考或工具参数。仅统计已收到输出的流式请求。';
