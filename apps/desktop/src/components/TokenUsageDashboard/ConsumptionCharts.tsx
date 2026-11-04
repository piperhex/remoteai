import inlineCopy from '@remoteai/i18n/copy/inline/desktop/components/TokenUsageDashboard/ConsumptionCharts';
import { interpolate as interpolateCopy } from '@remoteai/i18n';
import { getLocale } from "../../i18n";
import { uiText } from "../../../../../shared/localization/uiText";
import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";
import type { Language } from "../../i18n";
import type { DailyTokenUsageBreakdown } from "../../../../../shared/token-usage/analytics";
import { COMPACT_TOOLTIP_STYLE, formatTokens, type ChartPalette } from "../../../../../shared/token-usage/chartUtils";
import { EChart } from "./EChart";
import styles from "./index.module.less";

type ConsumptionField = Exclude<keyof DailyTokenUsageBreakdown, "date">;
interface SeriesDefinition { name: string; field: ConsumptionField }
interface ConsumptionProps {
  daily: DailyTokenUsageBreakdown[];
  dateKeys: string[];
  language: Language;
  palette: ChartPalette;
  thresholdTokens: number;
  loading: boolean;
  error: boolean;
}

function consumptionOption(options: {
  props: ConsumptionProps; definitions: SeriesDefinition[];
}): EChartsCoreOption {
  const { props: { daily, dateKeys, palette, language }, definitions } = options;
  const byDate = new Map(daily.map((entry) => [entry.date, entry]));
  return {
    animationDurationUpdate: 280,
    aria: { enabled: true, label: { description: (language !== "zh" && language !== "en" ? uiText("client.usage.dailyTokenUsageByCategoryUseTheLegendToToggle", {}, language) : language === "zh"
      ? inlineCopy["Token_3504c862"]
      : inlineCopy["Daily_stacked_token_usage_Use_ba34dad9"]) } },
    color: [palette.series[0], "#cb8b41", palette.muted],
    tooltip: { trigger: "axis", confine: true, extraCssText: COMPACT_TOOLTIP_STYLE,
      axisPointer: { type: "shadow" },
      valueFormatter: (value: unknown) => `${formatTokens(Number(value), language)} Tokens` },
    legend: { top: 4, textStyle: { color: palette.text, fontSize: 11 } },
    grid: { left: 16, right: 20, top: 42, bottom: 12, containLabel: true },
    xAxis: { type: "category", data: dateKeys, axisLabel: { color: palette.muted, hideOverlap: true,
      formatter: (value: string) => value.slice(5) }, axisLine: { lineStyle: { color: palette.grid } } },
    yAxis: { type: "value", axisLabel: { color: palette.muted,
      formatter: (value: number) => formatTokens(value, language) },
      splitLine: { lineStyle: { color: palette.grid } } },
    series: definitions.map(({ name, field }) => ({
      name, type: "bar", stack: "tokens", barMaxWidth: 24,
      emphasis: { focus: "series" }, data: dateKeys.map((key) => byDate.get(key)?.[field] ?? 0),
    })),
  };
}

function ConsumptionPanel({ props, title, hint, definitions }: {
  props: ConsumptionProps; title: string; hint: string; definitions: SeriesDefinition[];
}) {
  const { daily, language, loading, error } = props;
  const option = useMemo(() => consumptionOption({ props, definitions }), [props, definitions]);
  const totals = definitions.map(({ name, field }) => ({
    name, tokens: daily.reduce((sum, entry) => sum + entry[field], 0),
  }));
  const totalTokens = totals.reduce((sum, entry) => sum + entry.tokens, 0);
  return <section className={styles.tokenChartPanel}>
    <div className={styles.tokenChartHeading}><h2>{title}</h2></div>
    <p className={styles.analyticsHint}>{hint}</p>
    {!error ? <div className={styles.consumptionTotals}>
      {totals.map(({ name, tokens }) => <div key={name}>
        <span>{name}</span><strong>{formatTokens(tokens, language)}</strong>
        <small>{totalTokens > 0 ? `${(tokens / totalTokens * 100).toFixed(1)}%` : "—"}</small>
      </div>)}
    </div> : null}
    {error ? <p className={styles.tokenUsageError} role="alert">
      {(language !== "zh" && language !== "en" ? uiText("client.usage.couldNotRefreshUsageStatisticsPleaseTryAgain", {}, language) : language === "zh" ? inlineCopy["text_38868339"] : inlineCopy["Could_not_refresh_consumption_statistics_ff56d170"])}
    </p> : null}
    {error ? null : totalTokens > 0 ? <EChart option={option} label={title} />
      : <div className={styles.tokenDashboardEmpty}>
      {loading ? ((language !== "zh" && language !== "en" ? uiText("client.projectBrowser.loading", {}, language) : language === "zh" ? inlineCopy["text_21bd738e"] : inlineCopy["Loading_ba3bbbe1"]))
        : ((language !== "zh" && language !== "en" ? uiText("client.mobile.noTokenUsageInThisPeriod", {}, language) : language === "zh" ? inlineCopy["Token_494cfd50"] : inlineCopy["No_token_usage_in_this_812fc274"]))}
    </div>}
  </section>;
}

export function ConsumptionCharts(props: ConsumptionProps) {
  const { language } = props;
  const zh = language === "zh";
  const localized = language !== "zh" && language !== "en";
  const unknown = localized ? uiText("client.chat.unknown", {}, language) : zh ? inlineCopy["text_52e83fa7"] : inlineCopy["Unknown_b764cdc0"];
  const threshold = new Intl.NumberFormat(getLocale(language)).format(props.thresholdTokens);
  const contextDefinitions: SeriesDefinition[] = [
    { name: localized ? uiText("client.chat.shortContext", {}, language) : zh ? inlineCopy["text_5a81a590"] : inlineCopy["Short_context_2c449ebc"], field: "shortContextTokens" },
    { name: localized ? uiText("client.chat.longContext", {}, language) : zh ? inlineCopy["text_1fa7f3cc"] : inlineCopy["Long_context_45aa7e73"], field: "longContextTokens" },
    { name: unknown, field: "unknownContextTokens" },
  ];
  const modeDefinitions: SeriesDefinition[] = [
    { name: localized ? uiText("client.chat.standardMode", {}, language) : zh ? inlineCopy["text_47bd3769"] : inlineCopy["Standard_mode_9b38d742"], field: "standardModeTokens" },
    { name: localized ? uiText("client.chat.fastMode.6e02d1", {}, language) : zh ? inlineCopy["text_6e02d1ce"] : inlineCopy["Fast_mode_1b7f9ecb"], field: "fastModeTokens" },
    { name: unknown, field: "unknownModeTokens" },
  ];
  return <div className={`${styles.tokenDashboardGrid} ${styles.consumptionGrid}`}>
    <ConsumptionPanel props={props} definitions={contextDefinitions}
      title={localized ? uiText("client.chat.shortLongContextUsage", {}, language) : zh ? inlineCopy["text_b79dac36"] : inlineCopy["Short_Long_Context_Usage_46668a14"]}
      hint={localized ? uiText("client.mobile.inputsAboveTokensIncludingCacheCountAsLongContextUsage", { value1: threshold }, language)
        : zh ? interpolateCopy(inlineCopy["value1_Tokens_16dc6f8c"], { value1: String(threshold) })
        : interpolateCopy(inlineCopy["Inputs_above_value1_tokens_including_be832757"], { value1: String(threshold) })} />
    <ConsumptionPanel props={props} definitions={modeDefinitions}
      title={localized ? uiText("client.chat.standardFastModeUsage", {}, language) : zh ? inlineCopy["text_43b356d9"] : inlineCopy["Standard_Fast_Mode_Usage_94e45531"]}
      hint={localized ? uiText("client.chat.dailyTokenTotalsUsageWithoutARecordedModeIsShown", {}, language)
        : zh ? inlineCopy["Token_a37b528e"]
        : inlineCopy["Actual_tokens_per_day_usage_7a0ca3e0"]} />
  </div>;
}
