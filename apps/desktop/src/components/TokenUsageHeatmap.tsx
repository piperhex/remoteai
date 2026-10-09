import { getLocale } from "../i18n";
import { guiText } from "../i18n/guiText";
import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "antd";
import {
  loadDailyTokenUsage,
  loadTokenUsageEntries,
  subscribeToTokenUsageChanges,
} from "../api/backend";
import type { Language, Translate } from "../i18n";
import type { DailyTokenUsage, Provider } from "../types";
import { ProxyConversationMetrics } from "./ProxyConversationMetrics";
import { formatCompactTokenCount } from "../utils/tokenContext";
import {
  estimateTokenCost,
  invalidateCustomTokenCostRulesCache,
  formatEstimatedCost,
  formatEstimatedCostValue,
  TOKEN_COST_CUSTOM_RULES_EVENT,
} from "../utils/tokenCost";
import { TOKEN_COST_REFERENCE_MODEL_EVENT } from "../utils/tokenCostPresets";
import {
  FAST_MODE_COST_MULTIPLIER_EVENT,
  FAST_MODE_COST_MULTIPLIER_STORAGE_KEY,
} from "../utils/tokenCostFastMode";
import { LONG_CONTEXT_COST_EVENT, LONG_CONTEXT_COST_STORAGE_KEY } from "../utils/tokenCostLongContext";
import { useTokenCostDisplaySettings } from "./TokenCostUnitSettings";
import {
  DailyTokenUsageTooltip,
  EMPTY_TOKEN_TOTALS,
  type TokenTypeTotals,
} from "./DailyTokenUsageTooltip";

const DAYS_PER_WEEK = 7;
const TOKEN_USAGE_MORE_THRESHOLD = 100_000_000;

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayStartTimestamp() {
  const today = new Date();
  return Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1_000);
}

function startOfCalendar(weeks: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - (weeks - 1) * DAYS_PER_WEEK);
  return start;
}

function calendarWeeks(weeks: number) {
  const start = startOfCalendar(weeks);
  return Array.from({ length: weeks }, (_, weekIndex) => (
    Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex) => {
      const date = new Date(start);
      date.setDate(start.getDate() + weekIndex * DAYS_PER_WEEK + dayIndex);
      return date;
    })
  ));
}

function intensity(total: number, maximum: number) {
  if (total <= 0 || maximum <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((total / maximum) * 4)));
}

function formatTokenCount(value: number, numberFormat: Intl.NumberFormat) {
  if (value < 1_000_000) return numberFormat.format(value);
  const millions = new Intl.NumberFormat(numberFormat.resolvedOptions().locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 1_000_000);
  return `${millions}M`;
}

function tokenTypeTotals(usage?: DailyTokenUsage): TokenTypeTotals {
  if (!usage) return EMPTY_TOKEN_TOTALS;
  return {
    total: usage.totalTokens,
    input: usage.inputTokens,
    output: usage.outputTokens,
    reasoning: usage.reasoningTokens,
    cached: usage.cachedTokens,
  };
}

export function TokenUsageHeatmap({
  weeks,
  refreshSeconds,
  language,
  t,
  providers,
}: {
  weeks: number;
  refreshSeconds: number;
  language: Language;
  t: Translate;
  providers: Provider[];
}) {
  const [entries, setEntries] = useState<DailyTokenUsage[]>([]);
  const [todayEstimatedCost, setTodayEstimatedCost] = useState(0);
  const [estimatedCostByDate, setEstimatedCostByDate] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarVersion, setCalendarVersion] = useState(0);
  const columns = useMemo(() => calendarWeeks(weeks), [calendarVersion, weeks]);
  const today = dateKey(new Date());

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const startTs = Math.floor(startOfCalendar(weeks).getTime() / 1000);
        const [nextEntries, usageEntries] = await Promise.all([
          loadDailyTokenUsage(startTs),
          loadTokenUsageEntries(startTs),
        ]);
        if (!active) return;
        setEntries(nextEntries);
        const costsByDate = new Map<string, number>();
        usageEntries.forEach((entry) => {
          const key = dateKey(new Date(entry.ts * 1_000));
          costsByDate.set(key, (costsByDate.get(key) ?? 0) + estimateTokenCost(entry, providers));
        });
        setEstimatedCostByDate(costsByDate);
        setTodayEstimatedCost(costsByDate.get(dateKey(new Date())) ?? 0);
        setError(null);
        setCalendarVersion((version) => version + 1);
      } catch (nextError) {
        if (active) setError(String(nextError));
      } finally {
        refreshing = false;
        if (active) setLoading(false);
      }
    };

    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshSeconds * 1000);
    const unsubscribe = subscribeToTokenUsageChanges(() => void refresh());
    const refreshStoredMultiplier = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage
        || (event.key !== null && event.key !== FAST_MODE_COST_MULTIPLIER_STORAGE_KEY
          && event.key !== LONG_CONTEXT_COST_STORAGE_KEY)) return;
      invalidateCustomTokenCostRulesCache();
      void refresh();
    };
    window.addEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, refresh);
    window.addEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, refresh);
    window.addEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, refresh);
    window.addEventListener(LONG_CONTEXT_COST_EVENT, refresh);
    window.addEventListener("storage", refreshStoredMultiplier);
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
      window.removeEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, refresh);
      window.removeEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, refresh);
      window.removeEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, refresh);
      window.removeEventListener(LONG_CONTEXT_COST_EVENT, refresh);
      window.removeEventListener("storage", refreshStoredMultiplier);
    };
  }, [providers, refreshSeconds, weeks]);

  const totals = useMemo(
    () => new Map(entries.map((entry) => [entry.date, entry])),
    [entries],
  );
  const todayTokenTotals = useMemo(() => tokenTypeTotals(totals.get(today)), [today, totals]);
  const total = useMemo(
    () => columns.flat().reduce((sum, date) => sum + (totals.get(dateKey(date))?.totalTokens ?? 0), 0),
    [columns, totals],
  );
  const numberFormat = useMemo(() => new Intl.NumberFormat(getLocale(language)), [language]);
  const tokenCostDisplay = useTokenCostDisplaySettings();
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(getLocale(language), {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }), [language]);
  const legendRanges = useMemo(() => Array.from({ length: 5 }, (_, level) => {
    if (level === 0) return { level, minimum: 0, maximum: 0 };
    return {
      level,
      minimum: level === 1 ? 1 : Math.floor((TOKEN_USAGE_MORE_THRESHOLD * (level - 1)) / 4) + 1,
      maximum: Math.ceil((TOKEN_USAGE_MORE_THRESHOLD * level) / 4),
    };
  }), []);

  return (
    <section className="token-heatmap" aria-label={t("tokenUsage.aria")} aria-busy={loading}>
      <div className="token-heatmap-summary" title={error ?? undefined}>
        <span>{t("tokenUsage.period", { weeks })}</span>
        <strong>{loading && entries.length === 0 ? "--" : formatTokenCount(total, numberFormat)}<small> Tokens</small></strong>
        <div className="token-heatmap-details">
          <span className="token-heatmap-today">
            {t("table.todayTokenUsageLabel")}{language === "zh" ? "：" : ": "}
            <Tooltip title={<DailyTokenUsageTooltip totals={todayTokenTotals} language={language} />} placement="top">
              <b>{formatCompactTokenCount(todayTokenTotals.total, language)}</b>
            </Tooltip>
          </span>
          <span className="token-heatmap-cost">
            {t("table.todayEstimatedCost")}{language === "zh" ? "：" : ": "}
            <b>{formatEstimatedCost(todayEstimatedCost, tokenCostDisplay)}</b>
          </span>
          <ProxyConversationMetrics language={language} t={t} />
        </div>
      </div>
      <div className="token-heatmap-chart">
        <div className="token-heatmap-weekdays" aria-hidden="true">
          <span>{(language === "ru" ? guiText("一", {}, language) : language === "zh" ? "一" : "M")}</span>
          <span>{(language === "ru" ? guiText("三", {}, language) : language === "zh" ? "三" : "W")}</span>
          <span>{(language === "ru" ? guiText("五", {}, language) : language === "zh" ? "五" : "F")}</span>
        </div>
        <div className="token-heatmap-content">
          <div className="token-heatmap-scroll">
            <div className="token-heatmap-columns">
              {columns.map((column) => (
                <div className="token-heatmap-week" key={dateKey(column[0])}>
                  {column.map((date) => {
                    const key = dateKey(date);
                    const usage = totals.get(key);
                    const tokens = usage?.totalTokens ?? 0;
                    const future = key > today;
                    const cell = (
                      <span
                        className={`token-heatmap-cell level-${intensity(tokens, TOKEN_USAGE_MORE_THRESHOLD)}${future ? " future" : ""}`}
                        aria-hidden="true"
                      />
                    );
                    if (future) return <span key={key}>{cell}</span>;
                    return (
                      <Tooltip
                        key={key}
                        title={(
                          <div className="token-heatmap-tooltip">
                            <strong>{dateFormat.format(date)}</strong>
                            <div className="token-heatmap-tooltip-details">
                              <span><b>{t("tokenUsage.total")}</b>{formatTokenCount(tokens, numberFormat)}</span>
                              <span><b>{t("tokenUsage.input")}</b>{formatTokenCount(usage?.inputTokens ?? 0, numberFormat)}</span>
                              <span><b>{t("tokenUsage.output")}</b>{formatTokenCount(usage?.outputTokens ?? 0, numberFormat)}</span>
                              <span><b>{t("tokenUsage.reasoning")}</b>{formatTokenCount(usage?.reasoningTokens ?? 0, numberFormat)}</span>
                              <span><b>{t("tokenUsage.cached")}</b>{formatTokenCount(usage?.cachedTokens ?? 0, numberFormat)}</span>
                              <span><b>{t("table.cost")}</b>{formatEstimatedCostValue(
                                estimatedCostByDate.get(key) ?? 0,
                                tokenCostDisplay,
                              )}</span>
                            </div>
                          </div>
                        )}
                      >
                        {cell}
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="token-heatmap-footer">
            <div className="token-heatmap-legend">
              <span>{t("tokenUsage.less")}</span>
              <div className="token-heatmap-legend-scale">
                {legendRanges.map((range) => (
                  <Tooltip key={range.level} title={range.level === 0
                    ? t("tokenUsage.rangeZero")
                    : t("tokenUsage.range", {
                      minimum: formatTokenCount(range.minimum, numberFormat),
                      maximum: formatTokenCount(range.maximum, numberFormat),
                    })}>
                    <span className={`token-heatmap-cell level-${range.level}`} />
                  </Tooltip>
                ))}
              </div>
              <span>{t("tokenUsage.more")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
