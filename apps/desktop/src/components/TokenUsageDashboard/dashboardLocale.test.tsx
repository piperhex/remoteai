// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Language } from "../../i18n";
import { chartPalette } from "../../../../../shared/token-usage/chartUtils";
import { ConsumptionCharts } from "./ConsumptionCharts";
import { quotaChartOption } from "./quotaChartOption";
import { useOverviewOptions } from "./useOverviewOptions";

vi.mock("./EChart", () => ({ EChart: () => null }));

const palette = chartPalette("#3f7d58", false);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderConsumption(language: Language) {
  await act(async () => root.render(<ConsumptionCharts daily={[]} dateKeys={[]} language={language}
    palette={palette} thresholdTokens={272000} loading={false} error={false} />));
  return container.textContent ?? "";
}

function quotaTooltip(language: Language) {
  const option = quotaChartOption({
    data: { primary: [], secondary: [], hasData: true, observedRange: null },
    accountLabel: "a@example.com", startTs: 1_700_000_000, endTs: 1_700_086_400,
    interval: "hour", view: "drop", language, dark: false, themeColor: "#3f7d58",
  }) as { tooltip: { formatter: (params: unknown) => string } };
  return option.tooltip.formatter([{ seriesName: "primary", value: [1_700_000_000_000, 1234.5] }]);
}

function monthNames(language: Language) {
  let nameMap: unknown;
  function Probe() {
    const { heatmapOption } = useOverviewOptions({ dailyUsage: [], dateKeys: ["2026-01-04", "2026-10-21"], language, palette });
    nameMap = (heatmapOption as { calendar: { monthLabel: { nameMap: unknown } } }).calendar.monthLabel.nameMap;
    return null;
  }
  return { Probe, read: () => nameMap };
}

it("shows Russian consumption copy with Russian number grouping", async () => {
  const text = await renderConsumption("ru");
  const threshold = new Intl.NumberFormat("ru-RU").format(272000);

  expect(text).toContain("Расход: короткий / длинный контекст");
  expect(text).toContain(`Ввод свыше ${threshold} токенов (включая кэш) считается длинным контекстом.`);
  expect(text).toContain("Короткий контекст");
  expect(text).toContain("Быстрый режим");
  expect(text).toContain("Неизвестно");
  expect(text).toContain("«Неизвестно»");
  expect(text).not.toMatch(/[一-鿿]/);
});

it("keeps the Chinese and English consumption copy unchanged", async () => {
  expect(await renderConsumption("zh")).toContain("单次输入超过 272,000 Tokens（含缓存）计为长上下文，累计整次请求的消耗。");
  expect(await renderConsumption("en")).toContain("Inputs above 272,000 tokens (including cache) are long context.");
});

it("formats quota tooltip numbers with the interface locale", () => {
  const russianNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(1234.5);

  expect(quotaTooltip("ru")).toContain(russianNumber);
  expect(quotaTooltip("zh")).toContain("1,234.5");
  expect(quotaTooltip("en")).toContain("1,234.5");
});

it("labels heatmap months in Russian", async () => {
  for (const [language, expected] of [
    ["ru", ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"]],
    ["zh", "ZH"],
    ["en", "EN"],
  ] as const) {
    const { Probe, read } = monthNames(language);
    await act(async () => root.render(<Probe />));
    expect(read()).toEqual(expected);
  }
});
