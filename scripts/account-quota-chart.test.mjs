import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadModule(path, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(`(function(require, exports) { ${source}\n })`, { Date, Intl, ...globals })(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const componentPath = "../apps/desktop/src/components/TokenUsageDashboard/";
const { buildQuotaChartData } = loadModule(`${componentPath}quotaHistoryData.ts`);
const { quotaChartOption } = loadModule(`${componentPath}quotaChartOption.ts`, {
  "../../i18n": { getLocale: language => language === "zh" ? "zh-CN" : "en-US" },
  "./quotaChartLabels": loadModule(`${componentPath}quotaChartLabels.ts`, {
    "../../i18n/guiText": { guiText: text => text },
  }),
  "./quotaSeriesSampling": loadModule(`${componentPath}quotaSeriesSampling.ts`),
  "../../utils/theme": loadModule("../apps/desktop/src/utils/theme.ts"),
});
const START = new Date(2026, 8, 6, 0, 0, 0).getTime() / 1_000;
const HOUR = 3_600;
const snapshot = (hours, primary, secondary = null, overrides = {}) => ({
  ts: START + hours * HOUR,
  primaryRemainingPercent: primary,
  secondaryRemainingPercent: secondary,
  primaryResetAt: null,
  secondaryResetAt: null,
  ...overrides,
});
const build = (points, overrides = {}) => buildQuotaChartData({
  points, startTs: START, endTs: START + 4 * HOUR, interval: "hour", view: "drop", ...overrides,
});
const values = series => Array.from(series, point => point[1]);

test("attributes an observed decrease using the range baseline and retains empty periods", () => {
  const result = build([snapshot(.75, 90, 70), snapshot(1.25, 86, 67)], { startTs: START + HOUR });
  assert.deepEqual(values(result.primary), [4, null, null, null]);
  assert.deepEqual(values(result.secondary), [3, null, null, null]);
  assert.equal(result.hasData, true);
});

test("sums only observed decreases and excludes resets and unknown reset transitions", () => {
  const firstReset = START + 5 * HOUR;
  const nextReset = START + 10 * HOUR;
  const points = [
    snapshot(0, 90, null, { primaryResetAt: firstReset }),
    snapshot(.1, 80, null, { primaryResetAt: firstReset }),
    snapshot(.2, 97, null, { primaryResetAt: nextReset }),
    snapshot(.3, 91, null, { primaryResetAt: nextReset }),
    snapshot(.4, 88), snapshot(.5, 84),
  ];
  assert.equal(build(points).primary[0][1], 20);
});

test("a reset with lower quota is not mistaken for consumption", () => {
  const points = [
    snapshot(0, 90, null, { primaryResetAt: START + HOUR }),
    snapshot(.25, 70, null, { primaryResetAt: START + 2 * HOUR }),
  ];
  assert.equal(build(points).hasData, false);
  const crossing = [
    snapshot(.25, 90, null, { primaryResetAt: START + HOUR / 2 }),
    snapshot(.75, 70, null, { primaryResetAt: START + HOUR / 2 }),
  ];
  assert.equal(build(crossing).hasData, false);
});

test("missing observations and long gaps do not become zero or fabricated hourly drops", () => {
  const points = [snapshot(0, 90, 70), snapshot(.25, null, 65), snapshot(.5, 70, 60), snapshot(3, 50, 55)];
  const result = build(points);
  assert.deepEqual(values(result.primary), [null, null, null, null, null]);
  assert.deepEqual(values(result.secondary), [10, null, null, null, null]);
  assert.equal(build([snapshot(.25, 50), snapshot(.5, 50)]).primary[0][1], 0);
});

test("remaining quota lines break across resets and gaps while keeping both real endpoints", () => {
  const result = build([snapshot(0, 90), snapshot(.25, 80), snapshot(.5, 99), snapshot(3, 70)], {
    view: "remaining",
  });
  assert.deepEqual(values(result.primary), [90, 80, null, 99, null, 70]);
  const option = quotaChartOption({
    data: result, accountLabel: "account", startTs: START, endTs: START + 4 * HOUR,
    interval: "hour", view: "remaining", language: "en", dark: false, themeColor: "#35ada7",
  });
  assert.equal(option.series[0].connectNulls, false);
  assert.equal(option.series[0].smooth, false);
  assert.equal(option.yAxis.max, 100);
});

test("sorts snapshots, uses the latest same-second observation, and rounds percentage noise", () => {
  const result = build([snapshot(.5, 99.8), snapshot(0, 99.9), snapshot(.5, 99.7)]);
  assert.equal(result.primary[0][1], .2);
  assert.equal(build([snapshot(0, 105), snapshot(.5, 95)]).hasData, false);
  assert.equal(build([], { endTs: START - 1 }).hasData, false);
});

test("longer intervals aggregate observed changes without filling absent buckets", () => {
  const points = [snapshot(0, 90), snapshot(2, 80), snapshot(5, 75), snapshot(7, 70)];
  const result = build(points, { interval: "sixHours", endTs: START + 12 * HOUR });
  assert.deepEqual(values(result.primary), [15, 5, null]);
});

test("tooltip escapes account and series labels and keeps unknown readings distinct from zero", () => {
  const option = quotaChartOption({
    data: build([]), accountLabel: '<img src=x onerror="alert(1)">',
    startTs: START, endTs: START + HOUR, interval: "hour", view: "drop",
    language: "en", dark: true, themeColor: "#35ada7",
  });
  const content = option.tooltip.formatter([
    { seriesName: "<b>Primary</b>", value: [START * 1_000, null] },
    { seriesName: "Secondary", value: [START * 1_000, 0] },
  ]);
  assert.equal(content.includes("<img"), false);
  assert.ok(content.includes("&lt;img"));
  assert.ok(content.includes("&lt;b&gt;Primary&lt;/b&gt;"));
  assert.ok(content.includes("No observation"));
  assert.ok(content.includes("0 pp"));
  assert.ok(option.tooltip.extraCssText.includes("max-width:400px"));
});

test("crops a long selected period to actual observations and excludes the pre-range baseline", () => {
  const startTs = START - 140 * 24 * HOUR;
  const endTs = START + 3 * 24 * HOUR;
  const data = build([snapshot(-140 * 24 - 1, 95), snapshot(0, 90), snapshot(1, 85), snapshot(72, 80)], {
    startTs, endTs,
  });
  const option = quotaChartOption({
    data, accountLabel: "account", startTs, endTs,
    interval: "hour", view: "drop", language: "en", dark: false, themeColor: "#35ada7",
  });
  assert.equal(data.observedRange.startTs, START);
  assert.equal(option.xAxis.min, START * 1_000);
  assert.equal(option.xAxis.max, endTs * 1_000);
  assert.ok(option.series[0].data.every(([timestamp]) => timestamp >= START * 1_000));
  assert.equal(option.dataZoom[0].startValue, START * 1_000);
});

test("zoom initially shows the last seven observed days while keeping the full recorded range available", () => {
  const endTs = START + 21 * 24 * HOUR;
  const data = build(Array.from({ length: 85 }, (_, index) => snapshot(index * 6, 90 - index * .25)), {
    endTs, interval: "sixHours",
  });
  const option = quotaChartOption({
    data, accountLabel: "account", startTs: START, endTs,
    interval: "sixHours", view: "drop", language: "zh", dark: false, themeColor: "#35ada7",
  });
  assert.equal(option.xAxis.min, START * 1_000);
  assert.equal(option.xAxis.max, endTs * 1_000);
  assert.equal(option.dataZoom[0].startValue, (START + 14 * 24 * HOUR) * 1_000);
  assert.equal(option.dataZoom[0].endValue, endTs * 1_000);
  assert.equal(option.dataZoom[1].type, "inside");
  assert.equal(option.dataZoom[0].filterMode, "none");
});

test("accessibility describes the quota series and missing periods without enumerating null values", () => {
  const option = quotaChartOption({
    data: build([snapshot(0, 95), snapshot(.5, 90), snapshot(3, null)]),
    accountLabel: "work@example.com", startTs: START, endTs: START + 4 * HOUR,
    interval: "hour", view: "drop", language: "zh", dark: false, themeColor: "#35ada7",
  });
  assert.ok(option.aria.label.description.includes("work@example.com"));
  assert.ok(option.aria.label.description.includes("主用量 / 次用量"));
  assert.ok(option.aria.label.description.includes("缺少记录"));
  assert.equal(/NaN|null/.test(option.aria.label.description), false);
});

function chartHarness() {
  const refs = [], effects = [], pending = [], updates = [], listeners = new Map();
  let refIndex = 0, effectIndex = 0, currentZoom, currentLegend, disposed = false, disconnected = false;
  const chart = {
    on: (name, callback) => listeners.set(name, callback),
    getOption: () => ({ dataZoom: [currentZoom], legend: [currentLegend] }),
    setOption: (option, flags) => {
      currentZoom = option.dataZoom?.[0]; currentLegend = option.legend; updates.push(flags);
    },
    resize: () => {}, dispose: () => { disposed = true; },
  };
  const { EChart } = loadModule(`${componentPath}EChart.tsx`, {
    react: {
      useRef: initial => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
      useEffect: (callback, dependencies) => {
        const index = effectIndex++, previous = effects[index];
        if (previous && dependencies.every((value, key) => value === previous.dependencies[key])) return;
        pending.push(() => {
          previous?.cleanup?.();
          effects[index] = { dependencies, cleanup: callback() };
        });
      },
    },
    "react/jsx-runtime": { jsx: (_type, props) => { if (props.ref) props.ref.current = {}; return props; } },
    "echarts/core": { init: () => chart },
    "./index.module.less": { default: { tokenEchart: "chart" } },
  }, {
    ResizeObserver: class { observe() {} disconnect() { disconnected = true; } },
  });
  return {
    updates,
    render: (option, preserveZoomKey, onZoomChange) => {
      refIndex = 0; effectIndex = 0;
      EChart({ option, label: "Quota", preserveZoomKey, onZoomChange });
      while (pending.length) pending.shift()();
    },
    zoom: range => { currentZoom = range; listeners.get("datazoom")(); },
    current: () => currentZoom,
    selectLegend: selected => { currentLegend = { selected }; },
    legend: () => currentLegend,
    unmount: () => { effects.forEach(effect => effect.cleanup?.()); return disposed && disconnected; },
  };
}

test("polling follows new data until the user zooms and then preserves their selected timestamps", () => {
  const harness = chartHarness();
  harness.render({ dataZoom: [{ startValue: 10, endValue: 100 }] }, "account:hour:drop");
  harness.render({ dataZoom: [{ startValue: 20, endValue: 110 }] }, "account:hour:drop");
  assert.equal(harness.updates.length, 2);
  assert.equal(harness.current().endValue, 110);
  harness.zoom({ startValue: 30, endValue: 50 });
  harness.render({ dataZoom: [{ startValue: 30, endValue: 120 }] }, "account:hour:drop");
  assert.equal(harness.updates.length, 3);
  assert.equal(harness.updates[2].lazyUpdate, false);
  assert.equal(harness.current().startValue, 30);
  assert.equal(harness.current().endValue, 50);
  assert.equal(harness.unmount(), true);
});

test("changing account or interval resets an old manual zoom", () => {
  const harness = chartHarness();
  harness.render({ dataZoom: [{ startValue: 10, endValue: 100 }] }, "account:hour:drop");
  harness.zoom({ startValue: 30, endValue: 50 });
  harness.render({ dataZoom: [{ startValue: 100, endValue: 200 }] }, "other:sixHours:drop");
  assert.equal(harness.updates.length, 2);
  assert.equal(harness.current().startValue, 100);
  assert.equal(harness.current().endValue, 200);
});

test("ordinary charts retain lazy rendering without quota zoom preservation", () => {
  const harness = chartHarness();
  harness.render({ series: [] });
  assert.equal(harness.updates[0].lazyUpdate, true);
});

test("zoom reports the selected timestamps to the latest sampling callback only", () => {
  const harness = chartHarness();
  const obsolete = [], current = [];
  harness.render({ dataZoom: [{ startValue: 0, endValue: 100 }] }, "account", range => obsolete.push(range));
  harness.render({ dataZoom: [{ startValue: 0, endValue: 100 }] }, "account", range => current.push(range));
  harness.zoom({ startValue: 30, endValue: 50 });
  assert.equal(obsolete.length, 0);
  assert.equal(current.length, 1);
  assert.equal(current[0].startValue, 30);
  harness.zoom({ startValue: NaN, endValue: 50 });
  assert.equal(current.length, 1);
  harness.unmount();
});

test("dense charts resample zoomed history while retaining the full slider range", () => {
  const count = 30_000;
  const points = Array.from({ length: count }, (_, index) => snapshot(index / 60, 100 - index / count * 100));
  const endTs = points.at(-1).ts;
  const data = build(points, { endTs, view: "remaining" });
  const settings = { data, accountLabel: "account", startTs: START, endTs,
    interval: "sixHours", view: "remaining", language: "en", dark: false, themeColor: "#35ada7" };
  const overview = quotaChartOption(settings);
  assert.ok(overview.series[0].data.length <= 800);
  assert.equal(overview.series[1].data.length, 0);
  assert.equal(overview.series[0].symbol(null, { dataIndex: 0 }), "none");
  assert.equal(overview.dataZoom[0].realtime, false);
  const visibleRange = { startValue: points[500].ts * 1_000, endValue: points[510].ts * 1_000 };
  const zoomed = quotaChartOption({ ...settings, visibleRange });
  assert.equal(zoomed.xAxis.min, START * 1_000);
  assert.equal(zoomed.xAxis.max, endTs * 1_000);
  assert.deepEqual(Array.from(zoomed.series[0].data, point => Array.from(point)),
    points.slice(499, 511).map(point => [point.ts * 1_000, point.primaryRemainingPercent]));
  assert.equal(zoomed.dataZoom[0].startValue, visibleRange.startValue);
  assert.equal(zoomed.dataZoom[0].endValue, visibleRange.endValue);
});

test("isolated observations remain visible without adding symbols to continuous lines", () => {
  const data = build([snapshot(0, 95), snapshot(3, 80)], { view: "remaining" });
  const option = quotaChartOption({ data, accountLabel: "account", startTs: START, endTs: START + 4 * HOUR,
    interval: "hour", view: "remaining", language: "en", dark: false, themeColor: "#35ada7" });
  assert.equal(option.series[0].symbol(null, { dataIndex: 0 }), "circle");
  assert.equal(option.series[0].symbol(null, { dataIndex: 1 }), "none");
  assert.equal(option.series[0].symbol(null, { dataIndex: 2 }), "circle");
});

test("resampling and polling preserve hidden series but a new chart scope resets them", () => {
  const harness = chartHarness();
  const option = { legend: {}, dataZoom: [{ startValue: 0, endValue: 100 }] };
  harness.render(option, "account");
  harness.selectLegend({ Primary: true, Secondary: false });
  harness.zoom({ startValue: 20, endValue: 40 });
  harness.render({ ...option }, "account");
  assert.equal(harness.legend().selected.Secondary, false);
  harness.render({ ...option }, "other");
  assert.equal(harness.legend().selected, undefined);
  harness.unmount();
});
