import inlineCopy from '@remoteai/i18n/copy/inline/desktop/components/TokenUsageDashboard/index';
import { interpolate as interpolateCopy } from '@remoteai/i18n';
import { getLocale } from "../../i18n";
import { uiText } from "../../../../../shared/localization/uiText";
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
import { aggregateEntries, calendarDateKeys, chartPalette, usagePieOption } from "../../../../../shared/token-usage/chartUtils";
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
  const labels = (language !== "zh" && language !== "en" ? {
    eyebrow: inlineCopy["PROVIDER_TOKEN_01cf0729"],
    title: uiText("client.usage.tokenUsageSummary", {}, language),
    period: uiText("client.usage.lastWeeks", { value1: weeks }, language),
    refresh: uiText("client.chat.refresh", {}, language),
    updated: uiText("client.accounts.updated", {}, language),
    heatmap: uiText("client.mobile.dailyTokenHeatmap", {}, language),
    heatmapHint: uiText("client.usage.darkerColorsIndicateHigherDailyTokenUsageTheDarkestShade", {}, language),
    trend: uiText("client.chat.dailyTokenTrend", {}, language),
    breakdown: uiText("client.mobile.tokenTotalsByType", {}, language),
    providers: uiText("client.chat.providerUsageRanking", {}, language),
    models: uiText("client.chat.modelUsageRanking", {}, language),
    accounts: uiText("client.chat.accountUsageRanking", {}, language),
    recent: uiText("client.usage.rankingsUseTheLatestProxyRequests", { value1: entries.length }, language),
    noData: uiText("client.chat.noTokenDataYet", {}, language),
  } : language === "zh" ? {
    eyebrow: inlineCopy["PROVIDER_TOKEN_01cf0729"],
    title: inlineCopy["Token_3e0d654c"],
    period: interpolateCopy(inlineCopy["value1_f8ae290d"], { value1: String(weeks) }),
    refresh: inlineCopy["text_aee88743"],
    updated: inlineCopy["text_7153f091"],
    heatmap: inlineCopy["Token_4ba5f066"],
    heatmapHint: inlineCopy["Token_100M_38be0b6d"],
    trend: inlineCopy["Token_6fad0d78"],
    breakdown: inlineCopy["Token_0f469306"],
    providers: inlineCopy["Provider_30e3cd68"],
    models: inlineCopy["text_d3767977"],
    accounts: inlineCopy["text_0447b84f"],
    recent: interpolateCopy(inlineCopy["value1_ac41e162"], { value1: String(entries.length) }),
    noData: inlineCopy["Token_739a63b2"],
  } : {
    eyebrow: inlineCopy["PROVIDER_TOKEN_01cf0729"],
    title: inlineCopy["Token_Usage_Summary_22ece17d"],
    period: interpolateCopy(inlineCopy["Last_value1_weeks_90109187"], { value1: String(weeks) }),
    refresh: inlineCopy["Refresh_0e916101"],
    updated: inlineCopy["Updated_3a5ecca1"],
    heatmap: inlineCopy["Daily_Token_Heatmap_74c47f1d"],
    heatmapHint: inlineCopy["Darker_cells_indicate_higher_daily_cc13cc77"],
    trend: inlineCopy["Daily_Token_Trend_8872a4b1"],
    breakdown: inlineCopy["Token_Type_Totals_f193fa02"],
    providers: inlineCopy["Provider_Usage_Ranking_a39f94fb"],
    models: inlineCopy["Model_Usage_Ranking_b9846d6d"],
    accounts: inlineCopy["Account_Usage_Ranking_cc46050c"],
    recent: interpolateCopy(inlineCopy["Rankings_use_the_latest_value1_43585b8f"], { value1: String(entries.length) }),
    noData: inlineCopy["No_token_data_0f1ce9b3"],
  });
  const proxyOnlyHint = (language !== "zh" && language !== "en" ? uiText("client.usage.tokenUsageIsRecordedOnlyInProxyMode", {}, language) : language === "zh"
    ? inlineCopy["Token_dafd73d1"]
    : inlineCopy["Token_usage_is_collected_only_dff91577"]);
  const rangeLabel = (language !== "zh" && language !== "en" ? uiText("client.chat.recent", {}, language) : language === "zh" ? inlineCopy["text_997a5e6e"] : inlineCopy["Last_eb970eb0"]);
  const weeksUnit = (language !== "zh" && language !== "en" ? uiText("client.chat.weeks", {}, language) : language === "zh" ? inlineCopy["text_5c553ec3"] : inlineCopy["weeks_eb0d2375"]);
  const palette = useMemo(() => chartPalette(themeColor, dark), [dark, themeColor]);
  const dateKeys = useMemo(() => calendarDateKeys(weeks), [dailyUsage, weeks]);
  const { heatmapOption, trendOption, breakdownOption } = useOverviewOptions({
    dailyUsage, dateKeys, language, palette,
  });

  const providerData = useMemo(() => aggregateEntries(entries, (entry) => entry.provider), [entries]);
  const modelData = useMemo(() => aggregateEntries(entries, (entry) => entry.model), [entries]);
  const accountData = useMemo(() => aggregateEntries(entries, (entry) => entry.accountEmail?.trim()
    || entry.accountId?.trim()
    || ((language !== "zh" && language !== "en" ? uiText("client.usage.unidentifiedAccount", {}, language) : language === "zh" ? inlineCopy["text_04020ae6"] : inlineCopy["Unknown_account_0ac22ebf"]))), [entries, language]);

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
        {(language !== "zh" && language !== "en" ? uiText("client.usage.couldNotRefreshTokenDataPleaseTryAgain", {}, language) : language === "zh" ? inlineCopy["Token_e999b69f"] : inlineCopy["Could_not_refresh_token_usage_34377d98"])}
      </div> : null}
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
      <ConsumptionCharts daily={breakdown} dateKeys={dateKeys} language={language} palette={palette}
        thresholdTokens={thresholdTokens} loading={loading} error={analyticsError} />
      <OfficialAccountUsage language={language} refreshSeconds={refreshSeconds}
        startTs={startTs} refreshKey={officialRefreshKey} />
      <AccountQuotaChart history={quotaHistory} startTs={startTs} endTs={endTs}
        language={language} dark={dark} themeColor={themeColor} loading={loading}
        error={quotaError ? ((language !== "zh" && language !== "en" ? uiText("client.usage.couldNotRefreshQuotaHistoryPleaseTryAgain", {}, language) : language === "zh" ? inlineCopy["text_760eab7b"] : inlineCopy["Could_not_refresh_quota_history_19d0ef0f"])) : undefined} />
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
