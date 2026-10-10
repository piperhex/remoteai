import { guiText } from "../../i18n/guiText";
import { Progress } from "antd";
import { useEffect, useState } from "react";
import type { Language, Translate } from "../../i18n";
import type { UsageWindow } from "../../types";
import { AccountUsageCard } from "./AccountUsageCard";
import { remainingTone, resetCountdownTime, resetCountdownWithDays, resetLabel, type UsageResetWindow } from "../../utils/format";

function usageStroke(value: number) {
  const tone = remainingTone(value);
  if (tone === "danger") return "#d2685b";
  if (tone === "warning") return "#d0a340";
  return "var(--green)";
}

function tableResetLabel(timestamp: number | null | undefined, language: Language, resetWindow: UsageResetWindow, now: number) {
  const label = resetLabel(timestamp, language, resetWindow);
  if (!timestamp) return label;
  if (resetWindow === "oneWeek") {
    const countdown = resetCountdownWithDays(timestamp, language, now);
    if (!countdown) return label;
    return (language === "ru" ? guiText("{value1} · 剩 {value2}", { value1: label, value2: countdown }, language) : language === "zh" ? `${label} · 剩 ${countdown}` : `${label} · ${countdown} left`);
  }
  const countdown = resetCountdownTime(timestamp, now);
  if (!countdown) return label;
  return (language === "ru" ? guiText("{value1} · 剩 {value2}", { value1: label, value2: countdown }, language) : language === "zh" ? `${label} · 剩 ${countdown}` : `${label} · ${countdown} left`);
}

function secondsSinceRefresh(timestamp: string | null | undefined, now: number) {
  if (!timestamp) return null;
  const refreshedAt = new Date(timestamp).getTime();
  if (Number.isNaN(refreshedAt)) return null;
  return Math.max(0, Math.floor((now - refreshedAt) / 1000));
}

export function UsageRefreshAge({ fetchedAt, t }: { fetchedAt?: string | null; t: Translate }) {
  const [now, setNow] = useState(() => Date.now());
  const seconds = secondsSinceRefresh(fetchedAt, now);

  useEffect(() => {
    if (seconds === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [seconds === null]);

  if (seconds === null) return null;
  return <span className="account-card-refresh-age">{t("usage.refreshAge", { seconds })}</span>;
}

interface UsageMeterProps {
  window?: UsageWindow | null;
  resetWindow: UsageResetWindow;
  fetchedAt?: string | null;
  variant?: "line" | "card";
  cardLabel?: string;
  cardLabelSuffix?: string;
  language: Language;
  t: Translate;
}

export function UsageMeter({
  window: usageWindow,
  resetWindow,
  fetchedAt,
  variant = "line",
  cardLabel,
  cardLabelSuffix,
  language,
  t,
}: UsageMeterProps) {
  const [now, setNow] = useState(() => Date.now());
  const recentRefreshSeconds = secondsSinceRefresh(fetchedAt, now);
  const tickerActive = Boolean(usageWindow?.resetsAt)
    || (variant === "line" && recentRefreshSeconds !== null);

  useEffect(() => {
    if (!tickerActive) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tickerActive, usageWindow?.resetsAt, fetchedAt]);

  if (variant === "card") return (
    <AccountUsageCard usage={usageWindow} language={language} now={now}
      label={[cardLabel, cardLabelSuffix].filter(Boolean).join(language === "zh" ? "" : " ")} />
  );
  if (!usageWindow) return <span className="usage-missing">--</span>;
  const remaining = Math.round(usageWindow.remainingPercent);
  const tone = remainingTone(remaining);
  return (
    <div className={`table-usage table-usage-${resetWindow}`}>
      <div className="table-usage-head">
        <strong className={tone}>{remaining}%</strong>
        <span>{t("usage.remaining")}</span>
        {recentRefreshSeconds !== null && (
          <span className="usage-recent-refresh">
            {t("usage.recentRefreshCompact", { seconds: recentRefreshSeconds })}
          </span>
        )}
      </div>
      <Progress percent={remaining} showInfo={false} size="small" strokeColor={usageStroke(remaining)} />
      <span className="usage-reset">
        <span>{tableResetLabel(usageWindow.resetsAt, language, resetWindow, now)}</span>
      </span>
    </div>
  );
}
