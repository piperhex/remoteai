export const CONVERSATION_METRICS_OPERATION = 'conversationMetrics';
export const CONVERSATION_METRICS_REFRESH_MS = 2_000;

export interface ConversationMetrics {
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
