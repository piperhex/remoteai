import { Card, Skeleton, Statistic } from "antd";
import type { UserChatTrafficSummary } from "../chat-traffic-types";
import { useI18n } from "../i18n-context";
import { formatTrafficBytes } from "./chat-traffic-chart";

interface ChatTrafficSummaryProps {
  summary?: UserChatTrafficSummary;
  month: string;
  loading: boolean;
}

export function ChatTrafficSummary({ summary, month, loading }: ChatTrafficSummaryProps) {
  const { language } = useI18n();
  const zh = language === "zh";
  const bytes = (value: number) => formatTrafficBytes(value, language);
  const metrics = [
    { title: zh ? "月累计用量" : "Monthly usage", period: month, value: summary && bytes(summary.monthBytes) },
    { title: zh ? "总转发量" : "Total relay traffic", value: summary && bytes(summary.totalBytes) },
    { title: zh ? "月活跃用户" : "Monthly active users", period: month, value: summary?.monthActiveUsers },
    { title: zh ? "总活跃用户" : "Total active users", value: summary?.totalActiveUsers },
  ];

  return <div className="chat-traffic-user-summary" aria-busy={loading}>
    {metrics.map((metric) => <Card key={metric.title} size="small">
      <div className="chat-traffic-metric-title">
        <span>{metric.title}</span>{metric.period && <span>{metric.period}</span>}
      </div>
      {loading ? <Skeleton.Input active size="small" /> : <Statistic value={metric.value ?? "—"} />}
    </Card>)}
  </div>;
}
