import { getLocale } from "../../i18n";
import type { EChartsCoreOption } from "echarts/core";
import type { Language } from "../../i18n";
import { normalizeThemeColor } from "../../utils/theme";
import { quotaChartLabels } from "./quotaChartLabels";
import type { QuotaChartData, QuotaInterval, QuotaSeriesPoint, QuotaView } from "./quotaHistoryData";
import { sampleQuotaSeries, type QuotaVisibleRange } from "./quotaSeriesSampling";

interface QuotaOptionProps {
  data: QuotaChartData;
  accountLabel: string;
  startTs: number;
  endTs: number;
  interval: QuotaInterval;
  view: QuotaView;
  language: Language;
  dark: boolean;
  themeColor: string;
  visibleRange?: QuotaVisibleRange;
}

interface TooltipEntry {
  name: string;
  ts: number;
  value: number | null;
}

const DAY_MILLISECONDS = 86_400_000;
const DEFAULT_VISIBLE_DAYS = 7;
const INTERVAL_MILLISECONDS: Record<QuotaInterval, number> = {
  hour: 3_600_000, sixHours: 21_600_000, day: DAY_MILLISECONDS,
};

function escapeHtml(value: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

function tooltipEntry(value: unknown): TooltipEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as { value?: unknown; seriesName?: unknown };
  if (!Array.isArray(entry.value) || typeof entry.value[0] !== "number") return null;
  return {
    name: typeof entry.seriesName === "string" ? entry.seriesName : "",
    ts: entry.value[0],
    value: typeof entry.value[1] === "number" && Number.isFinite(entry.value[1]) ? entry.value[1] : null,
  };
}

function timestampFormatter(language: Language, interval: QuotaInterval) {
  return new Intl.DateTimeFormat(getLocale(language), {
    month: "short", day: "numeric", year: "numeric",
    ...(interval === "day" ? {} : { hour: "2-digit", minute: "2-digit", hour12: false } as const),
  });
}

function tooltipFormatter(options: QuotaOptionProps) {
  const labels = quotaChartLabels(options.language);
  const unit = options.view === "drop" ? labels.points : "%";
  const timestamp = timestampFormatter(options.language, options.interval);
  const number = new Intl.NumberFormat(options.language === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 2,
  });
  return (params: unknown) => {
    const entries = (Array.isArray(params) ? params : [params])
      .map(tooltipEntry).filter((entry): entry is TooltipEntry => entry !== null);
    if (!entries.length) return "";
    const formattedTimestamp = timestamp.format(entries[0].ts);
    const rows = entries.map((entry) => {
      const value = entry.value === null ? labels.unknown : `${number.format(entry.value)} ${unit}`;
      return `<div>${escapeHtml(entry.name)}: <b>${escapeHtml(value)}</b></div>`;
    }).join("");
    return `<section style="max-width:400px;white-space:normal;overflow-wrap:anywhere">`
      + `<strong>${escapeHtml(options.accountLabel)}</strong>`
      + `<div>${escapeHtml(formattedTimestamp)}</div>${rows}</section>`;
  };
}

function quotaPalette(dark: boolean, themeColor: string) {
  return {
    grid: dark ? "#39453e" : "#e8ede8",
    panel: dark ? "#1e2521" : "#ffffff",
    text: dark ? "#b7c2bb" : "#526158",
    series: [normalizeThemeColor(themeColor), dark ? "#e2b568" : "#af762a"],
  };
}

function quotaTimeRange(options: QuotaOptionProps) {
  const observations = options.data.observedRange;
  let start = (observations?.startTs ?? options.startTs) * 1_000;
  let end = (observations?.endTs ?? options.endTs) * 1_000;
  if (options.view === "drop") {
    const firstValues = [options.data.primary, options.data.secondary]
      .map((series) => series.find(([, value]) => value !== null)?.[0]).filter((ts) => ts !== undefined);
    if (firstValues.length) start = Math.min(start, ...firstValues);
  }
  if (start === end) {
    const padding = INTERVAL_MILLISECONDS[options.interval] / 2;
    start -= padding;
    end += padding;
  }
  return { start: Math.max(options.startTs * 1_000, start), end: Math.min(options.endTs * 1_000, end) };
}

function quotaAxes(options: QuotaOptionProps, palette: ReturnType<typeof quotaPalette>) {
  const labels = quotaChartLabels(options.language);
  const range = quotaTimeRange(options);
  return {
    xAxis: {
      type: "time", min: range.start, max: range.end, splitNumber: 4,
      axisLabel: { color: palette.text, hideOverlap: true, fontSize: 10 },
      axisLine: { lineStyle: { color: palette.grid } },
      axisTick: { show: false }, splitLine: { show: false },
    },
    yAxis: {
      type: "value", min: 0, max: options.view === "remaining" ? 100 : undefined,
      name: options.view === "drop" ? labels.points : "%",
      nameTextStyle: { color: palette.text, fontSize: 10 },
      axisLabel: { color: palette.text, fontSize: 10 },
      splitLine: { lineStyle: { color: palette.grid } },
    },
  };
}

function quotaVisibleRange(options: QuotaOptionProps): QuotaVisibleRange {
  const range = quotaTimeRange(options);
  return options.visibleRange ?? {
    startValue: Math.max(range.start, range.end - DEFAULT_VISIBLE_DAYS * DAY_MILLISECONDS), endValue: range.end,
  };
}

function quotaDataZoom(options: QuotaOptionProps, palette: ReturnType<typeof quotaPalette>) {
  const shared = {
    xAxisIndex: 0, filterMode: "none",
    ...quotaVisibleRange(options),
    throttle: 100,
  };
  return [
    {
      ...shared, id: "quota-time-slider", type: "slider", height: 20, bottom: 4, left: 42, right: 18,
      showDetail: false, showDataShadow: false, moveHandleSize: 0, realtime: false,
      borderColor: palette.grid, fillerColor: `${palette.series[0]}33`,
      handleStyle: { color: palette.series[0], borderColor: palette.series[0] },
      textStyle: { color: palette.text },
    },
    { ...shared, id: "quota-time-inside", type: "inside", zoomOnMouseWheel: "ctrl", moveOnMouseMove: true },
  ];
}

export function quotaChartDescription(options: Pick<QuotaOptionProps, "language" | "accountLabel" | "view">) {
  const labels = quotaChartLabels(options.language);
  const viewHint = options.view === "drop" ? labels.dropHint : labels.remainingHint;
  return `${labels.title}: ${options.accountLabel}. ${labels.primary} / ${labels.secondary}. ${viewHint}`;
}

function quotaLineSeries(item: { name: string; data: QuotaSeriesPoint[] }, index: number) {
  return {
    ...item, type: "line", smooth: false, connectNulls: false,
    showSymbol: true, symbolSize: 4,
    symbol: (_value: unknown, params: { dataIndex: number }) => {
      const pointIndex = params.dataIndex;
      const isolated = item.data[pointIndex]?.[1] != null
        && item.data[pointIndex - 1]?.[1] == null && item.data[pointIndex + 1]?.[1] == null;
      return isolated ? "circle" : "none";
    },
    lineStyle: { width: 2, type: index === 0 ? "solid" : "dashed" },
    emphasis: { disabled: true },
  };
}

export function quotaChartOption(options: QuotaOptionProps): EChartsCoreOption {
  const labels = quotaChartLabels(options.language);
  const palette = quotaPalette(options.dark, options.themeColor);
  const range = quotaTimeRange(options);
  const visibleRange = quotaVisibleRange(options);
  const series = [
    { name: labels.primary, data: options.data.primary },
    { name: labels.secondary, data: options.data.secondary },
  ].map((item) => ({ ...item, data: sampleQuotaSeries(item.data, visibleRange)
    .filter(([timestamp]) => timestamp >= range.start && timestamp <= range.end) }));
  return {
    animation: false,
    aria: { enabled: true, label: { description: quotaChartDescription(options) } },
    color: palette.series,
    tooltip: {
      trigger: "axis", confine: true, backgroundColor: palette.panel, textStyle: { color: palette.text },
      transitionDuration: 0, axisPointer: { animation: false },
      extraCssText: "max-width:400px;white-space:normal;overflow-wrap:anywhere",
      formatter: tooltipFormatter(options),
    },
    legend: { top: 0, textStyle: { color: palette.text, fontSize: 11 } },
    grid: { left: 12, right: 18, top: 45, bottom: 48, containLabel: true },
    dataZoom: quotaDataZoom(options, palette),
    ...quotaAxes(options, palette),
    series: series.map(quotaLineSeries),
  };
}
