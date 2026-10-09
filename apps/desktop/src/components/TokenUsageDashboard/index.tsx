import { getLocale } from "../../i18n";
import { guiText } from "../../i18n/guiText";
import { useMemo, useState } from "react";
import { Button, InputNumber } from "antd";
import { BarChart, HeatmapChart, LineChart, PieChart } from "echarts/charts";
import {
  AriaComponent,
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { RefreshCw } from "lucide-react";
import { MAX_TOKEN_USAGE_WEEKS, MIN_TOKEN_USAGE_WEEKS } from "../../hooks/useTokenUsagePreferences";
import type { Language } from "../../i18n";
import { EChart } from "./EChart";
import { CustomBillingButton } from "./CustomBillingButton";
import styles from "./index.module.less";
import { aggregateEntries, calendarDateKeys, chartPalette, usagePieOption } from "./chartUtils";
import { useOverviewOptions } from "./useOverviewOptions";
import { useDashboardData } from "./useDashboardData";
import { useLongContextThreshold } from "./useLongContextThreshold";
import { ConsumptionCharts } from "./ConsumptionCharts";
import { AccountQuotaChart } from "./QuotaHistoryChart";
import { OfficialAccountUsage } from "./OfficialAccountUsage";


use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  AriaComponent,
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export function TokenUsageDashboard({
  dark = false,
  language,
  themeColor,
  weeks,
  refreshSeconds,
  onWeeksChange,
  preferencesLoading = false,
  embedded = false,
}: {
  dark?: boolean;
  language: Language;
  themeColor: string;
  weeks: number;
  refreshSeconds: number;
  onWeeksChange?: (value: number | null) => void;
  preferencesLoading?: boolean;
  embedded?: boolean;
}) {
  const thresholdTokens = useLongContextThreshold();
  const [officialRefreshKey, setOfficialRefreshKey] = useState(0);
  const { entries, dailyUsage, breakdown, quotaHistory, loading, error, analyticsError, quotaError,
    updatedAt, startTs, endTs, load } = useDashboardData({ weeks, refreshSeconds, thresholdTokens });
  const locale = getLocale(language);
  const labels = (language === "ru" ? {
    eyebrow: "PROVIDER / TOKEN",
    title: guiText("Token 消耗汇总", {}, language),
    period: guiText("最近 {value1} 周", { value1: weeks }, language),
    refresh: guiText("刷新", {}, language),
    updated: guiText("更新于", {}, language),
    heatmap: guiText("每日 Token 热力图", {}, language),
    heatmapHint: guiText("颜色越深表示当天 Token 消耗越多，100M 及以上为最深色", {}, language),
    trend: guiText("每日 Token 趋势", {}, language),
    breakdown: guiText("Token 类型累计", {}, language),
    providers: guiText("Provider 消耗排行", {}, language),
    models: guiText("模型消耗排行", {}, language),
    accounts: guiText("账户消耗排行", {}, language),
    recent: guiText("排行基于最近 {value1} 条代理请求", { value1: entries.length }, language),
    noData: guiText("暂无 Token 数据", {}, language),
  } : language === "zh" ? {
    eyebrow: "PROVIDER / TOKEN",
    title: "Token 消耗汇总",
    period: `最近 ${weeks} 周`,
    refresh: "刷新",
    updated: "更新于",
    heatmap: "每日 Token 热力图",
    heatmapHint: "颜色越深表示当天 Token 消耗越多，100M 及以上为最深色",
    trend: "每日 Token 趋势",
    breakdown: "Token 类型累计",
    providers: "Provider 消耗排行",
    models: "模型消耗排行",
    accounts: "账户消耗排行",
    recent: `排行基于最近 ${entries.length} 条代理请求`,
    noData: "暂无 Token 数据",
  } : {
    eyebrow: "PROVIDER / TOKEN",
    title: "Token Usage Summary",
    period: `Last ${weeks} weeks`,
    refresh: "Refresh",
    updated: "Updated",
    heatmap: "Daily Token Heatmap",
    heatmapHint: "Darker cells indicate higher daily usage; 100M or more uses the darkest level",
    trend: "Daily Token Trend",
    breakdown: "Token Type Totals",
    providers: "Provider Usage Ranking",
    models: "Model Usage Ranking",
    accounts: "Account Usage Ranking",
    recent: `Rankings use the latest ${entries.length} proxy requests`,
    noData: "No token data",
  });
  const proxyOnlyHint = (language === "ru" ? guiText("仅代理模式会统计 Token 消耗", {}, language) : language === "zh"
    ? "仅代理模式会统计 Token 消耗"
    : "Token usage is collected only in proxy mode");
  const rangeLabel = (language === "ru" ? guiText("最近", {}, language) : language === "zh" ? "最近" : "Last");
  const weeksUnit = (language === "ru" ? guiText("周", {}, language) : language === "zh" ? "周" : "weeks");
  const palette = useMemo(() => chartPalette(themeColor, dark), [dark, themeColor]);
  const dateKeys = useMemo(() => calendarDateKeys(weeks), [dailyUsage, weeks]);
  const { heatmapOption, trendOption, breakdownOption } = useOverviewOptions({
    dailyUsage, dateKeys, language, palette,
  });

  const providerData = useMemo(() => aggregateEntries(entries, (entry) => entry.provider), [entries]);
  const modelData = useMemo(() => aggregateEntries(entries, (entry) => entry.model), [entries]);
  const accountData = useMemo(() => aggregateEntries(entries, (entry) => entry.accountEmail?.trim()
    || entry.accountId?.trim()
    || ((language === "ru" ? guiText("未识别账户", {}, language) : language === "zh" ? "未识别账户" : "Unknown account"))), [entries, language]);

  return (
    <div className={`${styles.tokenDashboard}${embedded ? ` ${styles.embedded}` : ""}`}>
      <header className={styles.tokenDashboardHeader}>
        <div>
          <span>{labels.eyebrow}</span>
          <h1>{labels.title}</h1>
          <small>{labels.period}{updatedAt ? ` · ${labels.updated} ${updatedAt.toLocaleTimeString(locale, {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
          })}` : ""}<span className={styles.tokenDashboardProxyNote}> · {proxyOnlyHint}</span></small>
        </div>
        <div className={styles.tokenDashboardActions}>
          <CustomBillingButton language={language} />
          <label className={styles.tokenDashboardRange}>
            <span>{rangeLabel}</span>
            <InputNumber min={MIN_TOKEN_USAGE_WEEKS} max={MAX_TOKEN_USAGE_WEEKS} step={1}
              value={weeks} disabled={preferencesLoading || !onWeeksChange}
              onChange={(value) => onWeeksChange?.(value)} aria-label={`${rangeLabel} ${weeksUnit}`} />
            <span>{weeksUnit}</span>
          </label>
          <Button icon={<RefreshCw className={loading ? "spin" : ""} size={15} />}
            onClick={() => { void load(); setOfficialRefreshKey((value) => value + 1); }} disabled={loading}>
            {labels.refresh}
          </Button>
        </div>
      </header>
      {error ? <div className={styles.tokenUsageError} role="alert">
        {(language === "ru" ? guiText("Token 数据刷新失败，请重试。", {}, language) : language === "zh" ? "Token 数据刷新失败，请重试。" : "Could not refresh token usage. Please retry.")}
      </div> : null}
      <OfficialAccountUsage language={language} refreshSeconds={refreshSeconds}
        startTs={startTs} refreshKey={officialRefreshKey} />
      <AccountQuotaChart history={quotaHistory} startTs={startTs} endTs={endTs}
        language={language} dark={dark} themeColor={themeColor} loading={loading}
        error={quotaError ? ((language === "ru" ? guiText("额度记录刷新失败，请重试。", {}, language) : language === "zh" ? "额度记录刷新失败，请重试。" : "Could not refresh quota history.")) : undefined} />
      <ConsumptionCharts daily={breakdown} dateKeys={dateKeys} language={language} palette={palette}
        thresholdTokens={thresholdTokens} loading={loading} error={analyticsError} />
      <div className={`${styles.tokenDashboardGrid} ${styles.tokenDashboardGridTop}`}>
        <section className={`${styles.tokenChartPanel} ${styles.tokenChartPanelHeatmap}`}>
          <div className={styles.tokenChartHeading}><h2>{labels.heatmap}</h2><span>{labels.heatmapHint}</span></div>
          <EChart option={heatmapOption} label={labels.heatmap} className="tokenEchartHeatmap" />
        </section>
        <section className={styles.tokenChartPanel}>
          <div className={styles.tokenChartHeading}><h2>{labels.trend}</h2><span>{labels.period}</span></div>
          <EChart option={trendOption} label={labels.trend} className="tokenEchartTrend" />
        </section>
      </div>
      <div className={`${styles.tokenDashboardGrid} ${styles.tokenDashboardGridBottom}`}>
        <section className={styles.tokenChartPanel}>
          <div className={styles.tokenChartHeading}><h2>{labels.breakdown}</h2><span>{labels.period}</span></div>
          <EChart option={breakdownOption} label={labels.breakdown} />
        </section>
        <section className={styles.tokenChartPanel}>
          <div className={styles.tokenChartHeading}><h2>{labels.providers}</h2><span>{labels.recent}</span></div>
          <EChart option={usagePieOption(providerData, palette, language)} label={labels.providers} />
        </section>
        <section className={styles.tokenChartPanel}>
          <div className={styles.tokenChartHeading}><h2>{labels.models}</h2><span>{labels.recent}</span></div>
          <EChart option={usagePieOption(modelData, palette, language)} label={labels.models} />
        </section>
        <section className={styles.tokenChartPanel}>
          <div className={styles.tokenChartHeading}><h2>{labels.accounts}</h2><span>{labels.recent}</span></div>
          <EChart option={usagePieOption(accountData, palette, language)} label={labels.accounts} />
        </section>
      </div>
      {!loading && !error && dailyUsage.length === 0 && entries.length === 0
        ? <div className={styles.tokenDashboardEmpty}>{labels.noData}</div> : null}
    </div>
  );
}
