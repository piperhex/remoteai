import RUSSIAN_MONTH_LABELSResource from '@remoteai/i18n/copy/desktop/russianMonths';
import inlineCopy from '@remoteai/i18n/copy/inline/desktop/components/TokenUsageDashboard/useOverviewOptions';
import { getLocale } from "../../i18n";
import { uiText } from "../../../../../shared/localization/uiText";
import { useMemo } from "react";
import type { EChartsCoreOption as EChartsOption } from "echarts/core";
import type { Language } from "../../i18n";
import type { DailyTokenUsage } from "../../types";
import { COMPACT_TOOLTIP_STYLE, dateFromKey, formatTokens, type ChartPalette } from "../../../../../shared/token-usage/chartUtils";

// ECharts registers only the EN and ZH locales by default, so Russian heatmap month labels are listed explicitly.
const RUSSIAN_MONTH_LABELS = RUSSIAN_MONTH_LABELSResource;

interface OverviewOptions {
  dailyUsage: DailyTokenUsage[];
  dateKeys: string[];
  language: Language;
  palette: ChartPalette;
}

interface OverviewContext extends OverviewOptions {
  locale: string;
  tokenLabels: { total: string; input: string; output: string; reasoning: string; cached: string };
  dailyByDate: Map<string, DailyTokenUsage>;
}

function heatmapTooltip(context: OverviewContext, key: string) {
  const { dailyByDate, locale, language, tokenLabels } = context;
  const usage = dailyByDate.get(key);
  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  }).format(dateFromKey(key));
  const row = (label: string, value: number) => (
    `<div><span>${label}</span><b>${formatTokens(value, language)}</b></div>`
  );
  const rows = [row(tokenLabels.total, usage?.totalTokens ?? 0),
    row(tokenLabels.input, usage?.inputTokens ?? 0), row(tokenLabels.output, usage?.outputTokens ?? 0),
    row(tokenLabels.reasoning, usage?.reasoningTokens ?? 0), row(tokenLabels.cached, usage?.cachedTokens ?? 0)];
  return `<section class="token-chart-tooltip"><strong>${date}</strong>${rows.join("")}</section>`;
}

function useHeatmapOption(context: OverviewContext) {
  const { dailyByDate, dateKeys, language, locale, palette, tokenLabels } = context;
  const heatmapOption = useMemo<EChartsOption>(() => ({
    animationDurationUpdate: 280,
    aria: { enabled: true },
    tooltip: { confine: true, extraCssText: COMPACT_TOOLTIP_STYLE,
      formatter: (params: { value?: [string, number] }) => heatmapTooltip(context, String(params.value?.[0] ?? "")),
    },
    visualMap: {
      type: "piecewise",
      orient: "horizontal",
      right: 18,
      top: 0,
      itemWidth: 11,
      itemHeight: 11,
      itemGap: 4,
      text: (language !== "zh" && language !== "en" ? [uiText("client.mobile.more", {}, language), uiText("client.mobile.less", {}, language)] : language === "zh" ? [inlineCopy["text_1940119f"], inlineCopy["text_62f99c9a"]] : [inlineCopy["More_d47d7cb0"], inlineCopy["Less_ae5239ec"]]),
      textStyle: { color: palette.muted, fontSize: 10 },
      pieces: [
        { value: 0, color: palette.heat[0] },
        { min: 1, max: 25_000_000, color: palette.heat[1] },
        { min: 25_000_001, max: 50_000_000, color: palette.heat[2] },
        { min: 50_000_001, max: 75_000_000, color: palette.heat[3] },
        { min: 75_000_001, color: palette.heat[4] },
      ],
    },
    calendar: {
      range: [dateKeys[0], dateKeys[dateKeys.length - 1]],
      left: "center",
      top: 44,
      bottom: 18,
      cellSize: [22, 22],
      splitLine: { show: false },
      itemStyle: { color: palette.heat[0], borderColor: palette.panel, borderWidth: 2 },
      yearLabel: { show: false },
      monthLabel: { color: palette.muted, fontSize: 10,
        nameMap: language !== "zh" && language !== "en" ? [...RUSSIAN_MONTH_LABELS] : language === "zh" ? "ZH" : "EN" },
      dayLabel: { firstDay: 0, color: palette.muted, fontSize: 10,
        nameMap: (language !== "zh" && language !== "en" ? [uiText("client.mobile.sun", {}, language), uiText("client.mobile.mon", {}, language), uiText("client.mobile.tue", {}, language), uiText("client.mobile.wed", {}, language), uiText("client.mobile.thu", {}, language), uiText("client.mobile.fri", {}, language), uiText("client.mobile.sat", {}, language)] : language === "zh" ? [inlineCopy["text_85217f7a"], inlineCopy["text_51a75f46"], inlineCopy["text_084b42f6"], inlineCopy["text_a4c3313d"], inlineCopy["text_754a9d58"], inlineCopy["text_c9b87f51"], inlineCopy["text_de07b538"]] : inlineCopy["EN_69374b09"]) },
    },
    series: [{
      type: "heatmap",
      coordinateSystem: "calendar",
      data: dateKeys.map((key) => [key, dailyByDate.get(key)?.totalTokens ?? 0]),
    }],
  }), [dailyByDate, dateKeys, language, locale, palette, tokenLabels]);

  return heatmapOption;
}

function useTrendOption(context: OverviewContext) {
  const { dailyByDate, dateKeys, language, palette, tokenLabels } = context;
  const trendOption = useMemo<EChartsOption>(() => {
    const definitions = [
      [tokenLabels.total, "totalTokens"],
      [tokenLabels.input, "inputTokens"],
      [tokenLabels.output, "outputTokens"],
      [tokenLabels.reasoning, "reasoningTokens"],
      [tokenLabels.cached, "cachedTokens"],
    ] as const;
    return {
      animationDurationUpdate: 280,
      aria: { enabled: true },
      color: palette.series,
      tooltip: { confine: true, extraCssText: COMPACT_TOOLTIP_STYLE, trigger: "axis",
        valueFormatter: (value: unknown) => `${formatTokens(Number(value), language)} Tokens` },
      legend: { top: 0, textStyle: { color: palette.text, fontSize: 10 } },
      grid: { left: 18, right: 22, top: 38, bottom: 18, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: dateKeys,
        axisLabel: { color: palette.muted, hideOverlap: true,
          formatter: (value: string) => value.slice(5) },
        axisLine: { lineStyle: { color: palette.grid } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: palette.muted, formatter: (value: number) => formatTokens(value, language) },
        splitLine: { lineStyle: { color: palette.grid } },
      },
      series: definitions.map(([name, field], index) => ({
        name,
        type: "line",
        smooth: .25,
        showSymbol: false,
        lineStyle: { width: index === 0 ? 2.5 : 1.5 },
        areaStyle: index === 0 ? { opacity: .08 } : undefined,
        data: dateKeys.map((key) => dailyByDate.get(key)?.[field] ?? 0),
      })),
    };
  }, [dailyByDate, dateKeys, language, palette, tokenLabels]);

  return trendOption;
}

function useTokenTypeOption(context: OverviewContext) {
  const { dailyUsage, language, palette, tokenLabels } = context;
  const breakdownOption = useMemo<EChartsOption>(() => {
    const totals = dailyUsage.reduce((current, entry) => ({
      input: current.input + entry.inputTokens,
      output: current.output + entry.outputTokens,
      reasoning: current.reasoning + entry.reasoningTokens,
      cached: current.cached + entry.cachedTokens,
    }), { input: 0, output: 0, reasoning: 0, cached: 0 });
    return {
      animationDurationUpdate: 280,
      aria: { enabled: true },
      tooltip: { confine: true, extraCssText: COMPACT_TOOLTIP_STYLE, trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value: unknown) => `${formatTokens(Number(value), language)} Tokens` },
      grid: { left: 16, right: 18, top: 16, bottom: 18, containLabel: true },
      xAxis: { type: "category",
        data: [tokenLabels.input, tokenLabels.output, tokenLabels.reasoning, tokenLabels.cached],
        axisTick: { show: false }, axisLine: { lineStyle: { color: palette.grid } },
        axisLabel: { color: palette.text } },
      yAxis: { type: "value",
        axisLabel: { color: palette.muted, formatter: (value: number) => formatTokens(value, language) },
        splitLine: { lineStyle: { color: palette.grid } } },
      series: [{ type: "bar", data: [totals.input, totals.output, totals.reasoning, totals.cached],
        barMaxWidth: 30,
        itemStyle: { color: (params: { dataIndex: number }) => palette.series[params.dataIndex],
          borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: palette.muted,
          formatter: (params: { value: number }) => formatTokens(Number(params.value), language) } }],
    };
  }, [dailyUsage, language, palette, tokenLabels]);

  return breakdownOption;
}

export function useOverviewOptions(options: OverviewOptions) {
  const { dailyUsage, language } = options;
  const locale = getLocale(language);
  const tokenLabels = useMemo(() => (language !== "zh" && language !== "en" ? { total: uiText("client.chat.total.e8dc87", {}, language), input: uiText("client.chat.input", {}, language), output: uiText("client.chat.output", {}, language), reasoning: uiText("client.chat.reasoning", {}, language), cached: uiText("client.chat.cached", {}, language) } : language === "zh"
    ? { total: inlineCopy["text_e8dc871a"], input: inlineCopy["text_2087c777"], output: inlineCopy["text_fb04addb"], reasoning: inlineCopy["text_132411ba"], cached: inlineCopy["text_e3ca04a9"] }
    : { total: inlineCopy["Total_c9b3c382"], input: inlineCopy["Input_36ecb4f8"], output: inlineCopy["Output_b2439bcb"], reasoning: inlineCopy["Reasoning_d8211e24"], cached: inlineCopy["Cached_a251c182"] }), [language]);
  const dailyByDate = useMemo(() => new Map(dailyUsage.map((entry) => [entry.date, entry])), [dailyUsage]);
  const context = { ...options, locale, tokenLabels, dailyByDate };
  const heatmapOption = useHeatmapOption(context);
  const trendOption = useTrendOption(context);
  const breakdownOption = useTokenTypeOption(context);
  return { heatmapOption, trendOption, breakdownOption };
}
