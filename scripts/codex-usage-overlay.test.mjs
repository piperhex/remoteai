import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const sourcePath = new URL(
  "../apps/desktop/src-tauri/src/dream_skin_native/speed_selector_overlay.rs",
  import.meta.url,
);
const rustSource = readFileSync(sourcePath, "utf8");
const overlaySource = rustSource.slice(rustSource.indexOf('r#"') + 3, rustSource.lastIndexOf('"#;'))
  .replace("__CODEX_SWITCH_SERVICE_TIER__", '"default"');
const stateKey = "__CODEX_SWITCH_SPEED_SELECTOR__";
const refreshIntervalMs = 5000;

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.hidden = false;
    this.textContent = "";
    this.listeners = new Map();
  }

  get firstElementChild() { return this.children[0]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  dispatch(name) { for (const callback of this.listeners.get(name) ?? []) callback(); }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  before(element) {
    const parent = this.parentElement;
    element.parentElement = parent;
    parent.children.splice(parent.children.indexOf(this), 0, element);
  }

  remove() {
    const parent = this.parentElement;
    if (parent) parent.children = parent.children.filter(child => child !== this);
    this.parentElement = null;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  querySelectorAll(selector) {
    const keys = [...selector.matchAll(/\[data-([a-z-]+)(?:="[^"]*")?\]/g)]
      .map(match => match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
    const matches = [];
    for (const child of this.children) {
      if (keys.some(key => Object.hasOwn(child.dataset, key))) matches.push(child);
      if (!selector.startsWith(":scope >")) matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

function createHarness({ dark = false, binding, fastModeAllowed = true } = {}) {
  const document = new Element();
  document.documentElement = document;
  document.createElement = () => new Element();
  const wrapper = new Element();
  const inner = new Element();
  const anchor = new Element();
  anchor.dataset.composerNavigationTarget = "reasoning";
  document.append(wrapper);
  wrapper.append(inner);
  inner.append(anchor);
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0;
  let requests = 0;
  let now = 0;
  const window = {
    __CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__: true,
    __CODEX_SWITCH_FAST_MODE_ALLOWED__: fastModeAllowed,
    codexSwitchRequestUsageSummary() { requests += 1; binding?.(); },
  };
  const context = {
    window, document,
    Date: { now: () => now },
    MutationObserver: class {
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    getComputedStyle: () => ({ color: dark ? "rgb(220,220,220)" : "rgb(30,30,30)" }),
    setInterval: (callback, delay) => { intervals.set(++timerId, { callback, delay }); return timerId; },
    clearInterval: id => intervals.delete(id),
    setTimeout: callback => { timeouts.set(++timerId, callback); return timerId; },
    clearTimeout: id => timeouts.delete(id),
  };
  runInNewContext(overlaySource, context);
  return {
    window, document, intervals, timeouts,
    get state() { return window[stateKey]; },
    get usage() { return document.querySelector("[data-today-usage]"); },
    get requests() { return requests; },
    advance(milliseconds) { now += milliseconds; },
    flushTimeouts() {
      for (const [id, callback] of timeouts) { timeouts.delete(id); callback(); }
    },
    poll() {
      for (const timer of intervals.values()) if (timer.delay === refreshIntervalMs) timer.callback();
    },
  };
}

function update(harness, overrides = {}) {
  harness.state.updateUsage({ enabled: true, totalTokens: 1234, estimatedCostUsd: 7.5, ...overrides });
  return harness.usage.querySelector("[data-trailing-balance]");
}

test("daily usage renders and keeps polling without Fast controls, and respects the display setting", () => {
  const harness = createHarness({ fastModeAllowed: false });
  harness.flushTimeouts();
  update(harness, { primaryRemainingPercent: 80 });
  const selector = harness.document.querySelector("[data-codex-switch-speed-selector]");
  assert.equal(selector.hidden, false);
  assert.equal(harness.usage.hidden, false);
  assert.equal(harness.usage.querySelector("[data-today-tokens]").textContent, "1.2K");
  assert.equal(selector.querySelector("[data-speed-controls]").hidden, true);
  harness.poll();
  harness.poll();
  harness.state.syncAll();
  assert.equal(harness.requests, 2);
  assert.equal(harness.usage.hidden, false);
  update(harness, { enabled: false });
  assert.equal(harness.usage.hidden, true);
  assert.equal(selector.hidden, true);
  update(harness);
  assert.equal(harness.usage.hidden, false);
  assert.equal(selector.hidden, false);
});

test("shows the current API daily estimate while preserving global daily usage", () => {
  const harness = createHarness();
  const trailing = update(harness, { providerEstimatedCost: { amountUsd: 1.25, aggregated: false } });
  assert.equal(trailing.textContent, "API 1.25USD");
  assert.equal(trailing.hidden, false);
  assert.equal(trailing.style.color, "rgb(180,93,0)");
  assert.equal(harness.usage.querySelector("[data-today-tokens]").textContent, "1.2K");
  assert.equal(harness.usage.querySelector("[data-today-cost]").textContent, "7.5USD");
  assert.match(harness.usage.title, /当前 API 今日预估成本：1.25USD/);
  assert.match(harness.usage.attributes["aria-label"], /当前 API 今日预估成本 1.25USD/);
  assert.doesNotMatch(harness.usage.title, /钱包/);
});

test("shows aggregate daily estimates in the cost color in both palettes", () => {
  for (const dark of [false, true]) {
    const harness = createHarness({ dark });
    const trailing = update(harness, { providerEstimatedCost: { amountUsd: 1234.56, aggregated: true } });
    assert.equal(trailing.textContent, "API 1,234.56USD");
    assert.equal(trailing.style.color, dark ? "rgb(245,177,65)" : "rgb(180,93,0)");
    assert.match(harness.usage.title, /聚合 API 今日总预估成本：1,234.56USD/);
  }
});

test("displays zero and small costs, and clamps negative costs", () => {
  const harness = createHarness();
  for (const [amountUsd, expected] of [[0, "0USD"], [0.0012, "0.0012USD"], [-2, "0USD"]]) {
    const trailing = update(harness, { providerEstimatedCost: { amountUsd } });
    assert.equal(trailing.textContent, `API ${expected}`);
    assert.equal(trailing.hidden, false);
    assert.equal(trailing.style.color, "rgb(180,93,0)");
  }
});

test("clears stale estimates for unavailable or invalid cost data", () => {
  const harness = createHarness();
  for (const amountUsd of [NaN, Infinity, -Infinity, "4.5", undefined, null]) {
    update(harness, { providerEstimatedCost: { amountUsd: 3 } });
    const trailing = update(harness, { providerEstimatedCost: { amountUsd } });
    assert.equal(trailing.hidden, true);
    assert.equal(trailing.textContent, "");
    assert.equal(harness.usage.querySelector("[data-balance-separator]").hidden, true);
    assert.doesNotMatch(harness.usage.title, /当前 API|聚合 API/);
  }
  update(harness, { providerEstimatedCost: { amountUsd: 3 } });
  assert.equal(update(harness).hidden, true);
});

test("switches between provider costs and official quota without retaining the previous display", () => {
  const harness = createHarness();
  update(harness, { providerEstimatedCost: { amountUsd: 1 } });
  for (const [percent, color] of [[10, "rgb(190,45,45)"], [40, "rgb(180,93,0)"], [80, "rgb(22,135,78)"]]) {
    const trailing = update(harness, { primaryRemainingPercent: percent, primaryRemainingAggregated: true });
    assert.equal(trailing.textContent, `${percent}%`);
    assert.equal(trailing.style.color, color);
    assert.match(harness.usage.title, /并发账号主用量余额合计/);
    assert.doesNotMatch(harness.usage.title, /当前 API|聚合 API/);
  }
  const trailing = update(harness, { providerEstimatedCost: { amountUsd: 2, aggregated: true } });
  assert.equal(trailing.textContent, "API 2USD");
  assert.match(harness.usage.title, /聚合 API 今日总预估成本/);
  assert.doesNotMatch(harness.usage.title, /主用量余额/);
});

test("keeps polling single-flight while rendering remains available", () => {
  const harness = createHarness();
  harness.flushTimeouts();
  for (let index = 0; index < 5; index += 1) {
    harness.poll();
    harness.window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
    harness.state.syncAll();
  }
  assert.equal(harness.requests, 1);
  assert.equal(harness.state.usagePending, true);
  assert.equal(harness.document.querySelectorAll("[data-codex-switch-speed-selector]").length, 1);
  update(harness, { providerEstimatedCost: { amountUsd: 2 } });
  harness.poll();
  assert.equal(harness.requests, 2);
});

test("resumes polling after a failed response or a disconnected binding", () => {
  const harness = createHarness();
  update(harness, { providerEstimatedCost: { amountUsd: 4 } });
  harness.flushTimeouts();
  harness.state.completeUsageRequest();
  assert.equal(harness.usage.querySelector("[data-trailing-balance]").textContent, "API 4USD");
  harness.poll();
  assert.equal(harness.requests, 2);
  const disconnected = createHarness({ binding() { throw new Error("Disconnected"); } });
  disconnected.flushTimeouts();
  assert.equal(disconnected.state.usagePending, false);
  disconnected.poll();
  assert.equal(disconnected.requests, 2);
});

test("retries an unacknowledged request after the deadline instead of remaining stale forever", () => {
  const harness = createHarness();
  harness.flushTimeouts();
  harness.advance(14999);
  harness.poll();
  assert.equal(harness.requests, 1);
  harness.advance(1);
  harness.poll();
  assert.equal(harness.requests, 2);
  update(harness, { totalTokens: 6789 });
  assert.equal(harness.usage.querySelector("[data-today-tokens]").textContent, "6.8K");
  harness.poll();
  assert.equal(harness.requests, 3);
});

test("refreshes when visible again and accepts pushed updates between polls", () => {
  const harness = createHarness();
  harness.flushTimeouts();
  update(harness);
  harness.document.hidden = true;
  harness.document.dispatch("visibilitychange");
  assert.equal(harness.requests, 1);
  harness.document.hidden = false;
  harness.document.dispatch("visibilitychange");
  assert.equal(harness.requests, 2);
  update(harness, { totalTokens: 5000 });
  update(harness, { totalTokens: 6000 });
  assert.equal(harness.usage.querySelector("[data-today-tokens]").textContent, "6K");
  assert.equal(harness.requests, 2);
});

test("clears old observers and all timers when reinstalling or disabling the overlay", () => {
  const harness = createHarness();
  const oldState = harness.state;
  oldState.version = 0;
  harness.window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
  assert.equal(oldState.installed, false);
  assert.equal(oldState.observer.disconnected, true);
  assert.equal(harness.intervals.size, 2);
  assert.equal(harness.timeouts.size, 1);
  assert.equal(harness.document.listeners.get("visibilitychange").size, 1);
  oldState.requestUsage();
  assert.equal(harness.requests, 0);
  const activeState = harness.state;
  harness.window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = false;
  for (const timer of harness.intervals.values()) if (timer.delay === 1000) timer.callback();
  assert.equal(activeState.installed, false);
  assert.equal(activeState.observer.disconnected, true);
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.timeouts.size, 0);
  assert.equal(harness.document.listeners.get("visibilitychange").size, 0);
  assert.equal(harness.document.querySelectorAll("[data-codex-switch-speed-selector]").length, 0);
  assert.equal(harness.state, undefined);
});

test("localizes the injected panel and updates an existing panel when language changes", () => {
  const harness = createHarness();
  const selector = harness.document.querySelector("[data-codex-switch-speed-selector]");
  const controls = selector.querySelector("[data-speed-controls]");
  const toggle = selector.querySelector("[data-speed-switch]");
  for (const [language, today, fast, cost] of [
    ["ru", "Сегодня", "Быстрый режим", "Общая стоимость API за сегодня: 1.25USD"],
    ["en", "Today", "Fast mode", "Combined API estimated cost today: 1.25USD"],
    ["zh", "今日", "快速模式", "聚合 API 今日总预估成本：1.25USD"],
  ]) {
    update(harness, { language, providerEstimatedCost: { amountUsd: 1.25, aggregated: true } });
    assert.equal(harness.usage.querySelector("[data-today-label]").textContent, today);
    assert.equal(controls.querySelector("[data-speed-label]").textContent, fast);
    assert.equal(toggle.attributes["aria-label"], fast);
    assert.match(harness.usage.title, new RegExp(cost.replaceAll(".", "\\.")));
    assert.equal(harness.usage.querySelector("[data-today-tokens]").textContent, "1.2K");
    if (language !== "zh") {
      assert.doesNotMatch(harness.usage.title + harness.usage.attributes["aria-label"]
        + selector.attributes["aria-label"], /[\u4e00-\u9fff]/);
    }
    assert.equal(harness.document.querySelectorAll("[data-codex-switch-speed-selector]").length, 1);
  }
  update(harness, { language: "ru", enabled: false });
  assert.equal(harness.usage.hidden, true);
  assert.equal(controls.querySelector("[data-speed-label]").textContent, "Быстрый режим");
  update(harness, { language: "unsupported", primaryRemainingPercent: 100 });
  assert.equal(harness.state.language, "ru");
  assert.match(harness.usage.title, /Остаток лимита аккаунта: 100%/);
});

test("updates language during a failed usage refresh without clearing data or overlapping requests", () => {
  const harness = createHarness();
  update(harness, { language: "en", providerEstimatedCost: { amountUsd: 1.25, aggregated: true } });
  const previousUsage = harness.state.usage;
  harness.flushTimeouts();
  harness.state.updateLanguage("ru");
  assert.equal(harness.state.usagePending, true);
  assert.equal(harness.state.usage, previousUsage);
  assert.equal(harness.document.querySelector("[data-speed-label]").textContent, "Быстрый режим");
  assert.equal(harness.usage.querySelector("[data-today-tokens]").textContent, "1.2K");
  assert.match(harness.usage.title, /Общая стоимость API за сегодня: 1\.25USD/);
  for (let index = 0; index < 5; index += 1) harness.poll();
  assert.equal(harness.requests, 1);
  harness.state.completeUsageRequest();
  assert.equal(harness.state.usage, previousUsage);
  harness.poll();
  assert.equal(harness.requests, 2);
  update(harness, { language: "ru", totalTokens: 5000 });
  assert.equal(harness.usage.querySelector("[data-today-tokens]").textContent, "5K");
  assert.equal(harness.state.usagePending, false);
});

test("localizes Fast controls before any usage succeeds and ignores invalid language updates", () => {
  const harness = createHarness();
  harness.flushTimeouts();
  harness.state.updateLanguage("ru");
  const toggle = harness.document.querySelector("[data-speed-switch]");
  assert.equal(harness.usage.hidden, true);
  assert.equal(toggle.attributes["aria-label"], "Быстрый режим");
  for (const language of [null, undefined, "unsupported", "__proto__"]) {
    harness.state.updateLanguage(language);
    assert.equal(harness.state.language, "ru");
  }
  harness.state.completeUsageRequest();
  harness.state.updateLanguage("en");
  assert.equal(toggle.attributes["aria-label"], "Fast mode");
  assert.equal(harness.usage.hidden, true);
  assert.equal(harness.document.querySelectorAll("[data-codex-switch-speed-selector]").length, 1);
});
