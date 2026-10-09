import { Tooltip } from "antd";
import { Gauge, Signal } from "lucide-react";
import { useRecentProxyConversationMetrics } from "../hooks/useRecentProxyConversationMetrics";
import type { Language, Translate } from "../i18n";
import type { ProxySessionLatencySummary } from "../types";
import { formatConversationTps } from "../utils/proxyConversationMetrics";

const GOOD_LATENCY_SECONDS = 2;
const WARNING_LATENCY_SECONDS = 3;

function conversationLatencyLevel(summary: ProxySessionLatencySummary) {
  if (!summary.requestCount) return "unknown";
  const averageSeconds = summary.totalFirstResponseTimeMs / summary.requestCount / 1_000;
  if (averageSeconds < GOOD_LATENCY_SECONDS) return "good";
  if (averageSeconds < WARNING_LATENCY_SECONDS) return "warning";
  return "poor";
}

export function ProxyConversationMetrics({ language, t }: { language: Language; t: Translate }) {
  const summary = useRecentProxyConversationMetrics();
  const latency = summary.requestCount
    ? `${(summary.totalFirstResponseTimeMs / summary.requestCount / 1_000).toFixed(1)}s`
    : "—";
  const tps = formatConversationTps(summary);
  const separator = language === "zh" ? "：" : ": ";
  return (
    <>
      <Tooltip
        title={t("table.averageConversationLatencyTooltip", { requests: summary.requestCount })}
        styles={{ root: { maxWidth: 400 } }}
      >
        <span
          className={`conversation-latency-indicator is-${conversationLatencyLevel(summary)}`}
          aria-label={`${t("table.averageConversationLatencyLabel")}: ${latency}`}
        >
          <span>{t("table.averageConversationLatencyLabel")}{separator}</span>
          <Signal size={13} strokeWidth={2.5} aria-hidden="true" />
          <strong>{latency}</strong>
        </span>
      </Tooltip>
      <Tooltip
        title={t("table.conversationTpsTooltip", { requests: summary.outputRequestCount })}
        styles={{ root: { maxWidth: 400 } }}
      >
        <span className="conversation-tps-indicator" aria-label={`${t("table.conversationTpsLabel")}: ${tps}`}>
          <span>{t("table.conversationTpsLabel")}{separator}</span>
          <Gauge size={13} strokeWidth={2.5} aria-hidden="true" />
          <strong>{tps}</strong>
        </span>
      </Tooltip>
    </>
  );
}
