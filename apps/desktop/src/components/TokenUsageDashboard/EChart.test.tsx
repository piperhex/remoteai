// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EChartsCoreOption } from "echarts/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EChart } from "./EChart";

const chartMocks = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("echarts/core", () => chartMocks);

function createChart() {
  const getOption = vi.fn<() => EChartsCoreOption | undefined>();
  const listeners = new Map<string, () => void>();
  return {
    getOption,
    setOption: vi.fn((option: EChartsCoreOption) => {
      getOption.mockReturnValue({
        ...option,
        legend: Array.isArray(option.legend) ? option.legend : [option.legend],
      });
    }),
    on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener); }),
    emitZoom: () => listeners.get("datazoom")?.(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}

const initialOption = {
  legend: { data: ["remaining"] },
  dataZoom: [{ type: "inside", startValue: 0, endValue: 100 }],
  series: [{ type: "line", data: [100, 90, 80] }],
} satisfies EChartsCoreOption;
const selectedRange = { startValue: 20, endValue: 60 };
const selectedLegend = { remaining: false };
let container: HTMLDivElement;
let root: Root;
let charts: ReturnType<typeof createChart>[];
const onZoomChange = vi.fn();

async function renderChart(option: EChartsCoreOption = initialOption, preserveZoomKey = "account-a") {
  await act(async () => root.render(<StrictMode>
    <EChart option={option} preserveZoomKey={preserveZoomKey} label="quota history" onZoomChange={onZoomChange} />
  </StrictMode>));
  return charts[charts.length - 1];
}

async function selectChartRange(chart: ReturnType<typeof createChart>) {
  chart.getOption.mockReturnValue({ legend: [{ selected: selectedLegend }], dataZoom: [selectedRange] });
  await act(async () => chart.emitZoom());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  charts = [];
  chartMocks.init.mockImplementation(() => {
    const chart = createChart();
    charts.push(chart);
    return chart;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("initializes a fresh chart during StrictMode effect replay without reading stale configuration", async () => {
  const chart = await renderChart();

  expect(charts).toHaveLength(2);
  expect(charts[0].dispose).toHaveBeenCalledOnce();
  expect(chart.getOption).not.toHaveBeenCalled();
  expect(chart.setOption).toHaveBeenCalledExactlyOnceWith(initialOption, { notMerge: true, lazyUpdate: false });
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("quota history");
});

it("preserves the selected zoom and legend when data refreshes in the same scope", async () => {
  const chart = await renderChart();
  await selectChartRange(chart);
  expect(onZoomChange).toHaveBeenCalledExactlyOnceWith(selectedRange);
  const refreshedOption = { ...initialOption, series: [{ type: "line", data: [100, 90, 70] }] };
  await renderChart(refreshedOption);

  expect(charts).toHaveLength(2);
  expect(chart.setOption).toHaveBeenLastCalledWith({
    ...refreshedOption,
    legend: { ...initialOption.legend, selected: selectedLegend },
    dataZoom: [{ type: "inside", ...selectedRange }],
  }, { notMerge: true, lazyUpdate: false });
});

it("resets zoom and legend when switching to another account or time scope", async () => {
  const chart = await renderChart();
  await selectChartRange(chart);
  chart.getOption.mockClear();
  await renderChart(initialOption, "account-b");

  expect(chart.getOption).not.toHaveBeenCalled();
  expect(chart.setOption).toHaveBeenLastCalledWith(initialOption, { notMerge: true, lazyUpdate: false });
});

it("ignores missing chart configuration when handling zoom or refreshing data", async () => {
  const chart = await renderChart();
  chart.getOption.mockReturnValue(undefined);
  await act(async () => chart.emitZoom());
  expect(onZoomChange).not.toHaveBeenCalled();
  const refreshedOption = { ...initialOption };
  await renderChart(refreshedOption);

  expect(chart.setOption).toHaveBeenLastCalledWith(refreshedOption, { notMerge: true, lazyUpdate: false });
});
