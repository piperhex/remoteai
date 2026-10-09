// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecentProxySessionLatency } from "../api/backend";
import type { ProxySessionLatencySummary } from "../types";
import { EMPTY_PROXY_CONVERSATION_METRICS } from "../utils/proxyConversationMetrics";
import { useRecentProxyConversationMetrics } from "./useRecentProxyConversationMetrics";

vi.mock("../api/backend", () => ({ loadRecentProxySessionLatency: vi.fn() }));

function Metrics() {
  const summary = useRecentProxyConversationMetrics();
  return <span>{summary.totalOutputTokens}</span>;
}

describe("recent conversation metric polling", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("skips overlapping refreshes while a request is active and stops after unmount", async () => {
    let finish!: (value: ProxySessionLatencySummary) => void;
    vi.mocked(loadRecentProxySessionLatency).mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }));
    await act(async () => root.render(<Metrics />));
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(loadRecentProxySessionLatency).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ...EMPTY_PROXY_CONVERSATION_METRICS, totalOutputTokens: 300 }));
    expect(container.textContent).toBe("300");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(loadRecentProxySessionLatency).toHaveBeenCalledTimes(2);
    await act(async () => root.render(null));
    await act(async () => finish({ ...EMPTY_PROXY_CONVERSATION_METRICS, totalOutputTokens: 600 }));
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(loadRecentProxySessionLatency).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("");
  });

  it("clears stale metrics after a failure and recovers on the next refresh", async () => {
    vi.mocked(loadRecentProxySessionLatency)
      .mockResolvedValueOnce({ ...EMPTY_PROXY_CONVERSATION_METRICS, totalOutputTokens: 300 })
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ ...EMPTY_PROXY_CONVERSATION_METRICS, totalOutputTokens: 600 });
    await act(async () => root.render(<Metrics />));
    expect(container.textContent).toBe("300");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(container.textContent).toBe("0");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(container.textContent).toBe("600");
  });
});
