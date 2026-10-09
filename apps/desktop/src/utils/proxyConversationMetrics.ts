import type { ProxySessionLatencySummary, ProxySessionRequest } from "../types";

export const EMPTY_PROXY_CONVERSATION_METRICS: ProxySessionLatencySummary = {
  totalFirstResponseTimeMs: 0,
  requestCount: 0,
  totalOutputTokens: 0,
  totalOutputTimeMs: 0,
  outputRequestCount: 0,
};

export function summarizeProxyRequests(requests: ProxySessionRequest[]): ProxySessionLatencySummary {
  const summary = { ...EMPTY_PROXY_CONVERSATION_METRICS };
  for (const request of requests) {
    if (request.firstResponseTimeMs == null) continue;
    summary.totalFirstResponseTimeMs += request.firstResponseTimeMs;
    summary.requestCount += 1;
    if (request.interrupted || request.outputTokens == null || request.responseTimeMs == null) continue;
    const outputTimeMs = request.responseTimeMs - request.firstResponseTimeMs;
    if (outputTimeMs <= 0) continue;
    summary.totalOutputTokens += request.outputTokens;
    summary.totalOutputTimeMs += outputTimeMs;
    summary.outputRequestCount += 1;
  }
  return summary;
}

export function formatConversationTps(summary: ProxySessionLatencySummary): string {
  if (!summary.outputRequestCount || !(summary.totalOutputTimeMs > 0)) return "—";
  return `${(summary.totalOutputTokens / summary.totalOutputTimeMs * 1_000).toFixed(1)} token/s`;
}
