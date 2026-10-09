import { useEffect, useState } from "react";
import { loadRecentProxySessionLatency } from "../api/backend";
import { EMPTY_PROXY_CONVERSATION_METRICS } from "../utils/proxyConversationMetrics";

const REFRESH_INTERVAL_MS = 2_000;

export function useRecentProxyConversationMetrics() {
  const [summary, setSummary] = useState(EMPTY_PROXY_CONVERSATION_METRICS);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const nextSummary = await loadRecentProxySessionLatency();
        if (active) setSummary(nextSummary);
      } catch {
        if (active) setSummary(EMPTY_PROXY_CONVERSATION_METRICS);
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  return summary;
}
