import { describe, expect, it } from "vitest";
import type { ProxySessionRequest } from "../types";
import {
  EMPTY_PROXY_CONVERSATION_METRICS,
  formatConversationTps,
  summarizeProxyRequests,
} from "./proxyConversationMetrics";

function request(overrides: Partial<ProxySessionRequest> = {}): ProxySessionRequest {
  return {
    id: 1, startedAt: 1, firstResponseTimeMs: 1_000, responseTimeMs: 2_000, outputTokens: 100, ...overrides,
  };
}

describe("proxy conversation TPS", () => {
  it("divides combined output tokens by output time, excluding the initial wait", () => {
    const summary = summarizeProxyRequests([
      request(),
      request({ outputTokens: 600, responseTimeMs: 4_000 }),
    ]);
    expect(summary).toEqual({
      totalFirstResponseTimeMs: 2_000, requestCount: 2,
      totalOutputTokens: 700, totalOutputTimeMs: 4_000, outputRequestCount: 2,
    });
    expect(formatConversationTps(summary)).toBe("175.0 token/s");
  });

  it("excludes unfinished, interrupted, missing usage and invalid duration requests from TPS", () => {
    const summary = summarizeProxyRequests([
      request({ responseTimeMs: null }), request({ outputTokens: null }),
      request({ interrupted: true }), request({ responseTimeMs: 1_000 }),
      request({ responseTimeMs: 500 }), request({ firstResponseTimeMs: null }),
    ]);
    expect(summary).toEqual({
      ...EMPTY_PROXY_CONVERSATION_METRICS, requestCount: 5, totalFirstResponseTimeMs: 5_000,
    });
    expect(formatConversationTps(summary)).toBe("—");
  });

  it("distinguishes a measured zero from absent measurements", () => {
    expect(formatConversationTps(summarizeProxyRequests([request({ outputTokens: 0 })]))).toBe("0.0 token/s");
    expect(formatConversationTps(summarizeProxyRequests([]))).toBe("—");
  });
});
