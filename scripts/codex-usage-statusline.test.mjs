import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { composerUsageOverlay, usageStatuslineScript } from "./fixtures/usage-statusline-source.mjs";

const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function trackVisibilityListeners(document) {
  const listeners = new Set();
  const addListener = document.addEventListener.bind(document);
  const removeListener = document.removeEventListener.bind(document);
  document.addEventListener = (name, fn, ...options) => {
    if (name === "visibilitychange") listeners.add(fn);
    addListener(name, fn, ...options);
  };
  document.removeEventListener = (name, fn, ...options) => {
    if (name === "visibilitychange") listeners.delete(fn);
    removeListener(name, fn, ...options);
  };
  return listeners;
}

function setup(autoRespond = true, dailyEnabled = true) {
  const dom = new JSDOM(`<div data-codex-composer-root data-composer-placement="thread">
    <div data-above-composer-conversation-id="one"></div><section>
    <div data-composer-surface-variant="default"><div contenteditable="true"></div></div></section></div>`);
  const { window } = dom;
  const document = window.document;
  Object.defineProperty(document, "hidden", { value: false });
  window.HTMLElement.prototype.getClientRects = () => [{}];
  const conversations = new Map(["one", "two"].map(id => [id, {
    resumeState: "resumed", threadRuntimeStatus: { type: "active" },
    latestTokenUsageInfo: { total: { outputTokens: 100, inputTokens: 1000, cachedInputTokens: 999 },
      last: { inputTokens: 1000, cachedInputTokens: 999, totalTokens: 1900 }, modelContextWindow: 10000 },
  }]));
  const manager = { getConversation: id => conversations.get(id), requestClient: { sendRequest() {
    throw new Error("The usage statusline must never send an app-server request");
  } } };
  const registry = { getImplForHostId: host => host === "local" ? manager : null, addRegistryCallback() {} };
  window.__codexRoot = { _internalRoot: { current: { memoizedProps: { value: registry } } } };
  window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = true;
  window.__CODEX_SWITCH_SPEED_SELECTOR__ = { installed: true, language: "zh", usage: { enabled: dailyEnabled } };
  const timing = { totalOutputTokens: 102, totalOutputTimeMs: 2000, outputRequestCount: 1 };
  const requests = [];
  const respond = (request, value = timing) => window.__CODEX_SWITCH_USAGE_STATUSLINE__
    ?.receiveTiming(request.conversationId, request.requestId, value);
  window.codexSwitchRequestConversationMetrics = payload => {
    const request = JSON.parse(payload); requests.push(request);
    if (autoRespond) respond(request);
  };
  let now = 1000;
  const timers = new Set();
  const visibilityListeners = trackVisibilityListeners(document);
  const context = { window, document, Element: window.Element, Date: { now: () => now }, setTimeout, clearTimeout,
    MutationObserver: window.MutationObserver, getComputedStyle: window.getComputedStyle.bind(window),
    setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); } };
  const run = () => runInNewContext(usageStatuslineScript, context);
  run();
  return { window, document, conversations, timers, run, requests, respond, timing, visibilityListeners,
    installOwner: () => runInNewContext(composerUsageOverlay, context),
    setNow(value) { now = value; }, refresh: () => window.__CODEX_SWITCH_USAGE_STATUSLINE__.refresh() };
}

test("mounts below the active input and reuses proxy timings without app-server requests", async () => {
  const h = setup(); await drain();
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  assert.equal(bar.previousElementSibling.getAttribute("data-composer-surface-variant"), "default");
  assert.equal(bar.textContent, "51.0 tok/s缓存命中 99.9%19.0%");
  assert.equal(h.requests.length, 1);
  h.conversations.get("one").latestTokenUsageInfo.total.outputTokens = 202;
  h.setNow(3000); await h.refresh();
  assert.equal(bar.textContent, "51.0 tok/s缓存命中 99.9%19.0%");
  assert.equal(h.requests.length, 2);
  h.run(); await drain();
  assert.equal(h.document.querySelectorAll("[data-codex-switch-usage-statusline]").length, 1);
  assert.equal(h.timers.size, 1, "reinjection reuses one timer");
  h.window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
  assert.equal(h.timers.size, 0);
});

test("switches identities, clears drafts and follows language independently of daily usage", async () => {
  const h = setup(); await drain();
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  h.document.querySelector("[data-above-composer-conversation-id]")
    .setAttribute("data-above-composer-conversation-id", "two");
  h.conversations.get("two").latestTokenUsageInfo.total.cachedInputTokens = 500;
  await h.refresh(); assert.match(bar.textContent, /50.0%/);
  h.window.__CODEX_SWITCH_SPEED_SELECTOR__.language = "en";
  await h.refresh(); assert.match(bar.textContent, /Cache hit/);
  h.document.querySelector("[data-codex-composer-root]").setAttribute("data-composer-placement", "home");
  await h.refresh(); assert.equal(bar.textContent, "— tok/sCache hit ——");
  h.window.__CODEX_SWITCH_SPEED_SELECTOR__.usage.enabled = false;
  await h.refresh(); assert.equal(bar.isConnected, true);
  assert.equal(bar.textContent, "— tok/sCache hit ——");
  assert.equal(h.timers.size, 1);
  h.window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
});

test("conversation metrics start before a daily summary arrives, including when daily usage is disabled", async () => {
  for (const dailyEnabled of [false, undefined]) {
    const h = setup(true, false);
    if (dailyEnabled === undefined) {
      delete h.window.__CODEX_SWITCH_SPEED_SELECTOR__.usage;
      h.run();
    }
    await drain();
    const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
    assert.equal(bar.textContent, "51.0 tok/s缓存命中 99.9%19.0%");
    assert.equal(h.requests.length, 1);
    h.window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
  }
});

test("the real daily switch preserves metrics, pending timing replies and polling without Fast controls", async () => {
  const h = setup(false); await drain();
  h.installOwner();
  const owner = h.window.__CODEX_SWITCH_SPEED_SELECTOR__;
  const summary = { enabled: true, totalTokens: 1234, estimatedCostUsd: 7.5, primaryRemainingPercent: 80 };
  owner.updateUsage(summary); await drain();
  const api = h.window.__CODEX_SWITCH_USAGE_STATUSLINE__;
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  assert.equal(owner.fastModeAllowed, false);
  assert.equal(owner.usageNode.parentElement, bar);
  assert.equal(owner.usageNode.hidden, false);
  const pending = h.requests.at(-1);
  for (const enabled of [false, true, false]) {
    owner.updateUsage({ ...summary, enabled }); await drain();
    assert.equal(h.window.__CODEX_SWITCH_USAGE_STATUSLINE__, api);
    assert.equal(bar.isConnected, true);
    assert.equal(owner.usageNode.hidden, !enabled);
    assert.equal(h.timers.size, 3);
    assert.equal(h.visibilityListeners.size, 2);
    assert.equal(h.requests.at(-1), pending, "daily toggles preserve the pending timing request");
  }
  h.respond(pending); await drain();
  assert.equal(bar.querySelector('[data-usage-metric="0"]').textContent, "51.0 tok/s");
  h.setNow(3000); await h.refresh();
  const current = h.requests.at(-1);
  assert.notEqual(current.requestId, pending.requestId);
  h.respond(pending, { ...h.timing, totalOutputTokens: 999 }); await drain();
  assert.equal(bar.querySelector('[data-usage-metric="0"]').textContent, "51.0 tok/s");
  h.respond(current, { ...h.timing, totalOutputTokens: 120 }); await drain();
  assert.equal(bar.querySelector('[data-usage-metric="0"]').textContent, "60.0 tok/s");
  h.window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = false;
  h.window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
  assert.equal(h.timers.size, 0);
  assert.equal(h.visibilityListeners.size, 0);
});

test("proxy stop clears all polling and restart restores exactly one statusline", async () => {
  const h = setup(false); await drain();
  h.installOwner();
  h.window.__CODEX_SWITCH_SPEED_SELECTOR__.updateUsage({ enabled: false }); await drain();
  const pending = h.requests.at(-1);
  h.window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = false;
  h.window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
  assert.equal(h.timers.size, 0);
  assert.equal(h.visibilityListeners.size, 0);
  assert.equal(h.document.querySelector("style"), null);
  const requests = h.requests.length;
  h.installOwner(); await drain();
  h.document.dispatchEvent(new h.window.Event("visibilitychange"));
  assert.equal(h.requests.length, requests);
  assert.equal(h.timers.size, 0, "reinjection outside proxy mode stays inactive");
  h.window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = true;
  h.window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
  h.window.__CODEX_SWITCH_SPEED_SELECTOR__.updateUsage({ enabled: false }); await drain();
  h.installOwner(); await drain();
  assert.equal(h.document.querySelectorAll("[data-codex-switch-usage-statusline]").length, 1);
  assert.equal(h.timers.size, 3);
  const current = h.requests.at(-1);
  assert.notEqual(current.requestId, pending.requestId);
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  h.respond(pending); await drain();
  assert.match(bar.textContent, /^— tok\/s/);
  h.respond(current); await drain();
  assert.match(bar.textContent, /^51.0 tok\/s/);
  assert.equal(h.window.__CODEX_SWITCH_SPEED_SELECTOR__.usageNode.hidden, true);
  h.window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = false;
  h.window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
});

test("Japanese reaches both overlays before accounting succeeds and through usage updates", async () => {
  const h = setup(); await drain();
  h.installOwner();
  const owner = h.window.__CODEX_SWITCH_SPEED_SELECTOR__;
  owner.updateLanguage("ja");
  assert.equal(owner.language, "ja");
  owner.updateUsage({ enabled: true }); await drain();
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  assert.equal(bar.getAttribute("aria-label"), "会話の使用状況");
  assert.match(bar.textContent, /キャッシュ命中率 99.9%/);
  assert.equal(bar.querySelector('[data-usage-metric="0"]').title,
    "この会話で完了したリクエストの平均出力速度。");
  owner.updateLanguage("en"); await drain();
  assert.match(bar.textContent, /Cache hit/);
  owner.updateUsage({ enabled: true, language: "ja" }); await drain();
  assert.match(bar.textContent, /キャッシュ命中率/);
  owner.updateLanguage("__proto__");
  assert.equal(owner.language, "ja");
  h.window.__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__ = false;
  h.window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__();
});

test("ambiguous editor identities and missing registries cannot leak another conversation", async () => {
  const h = setup(); await drain();
  delete h.window.__codexRoot;
  h.document.querySelector("[data-above-composer-conversation-id]").remove();
  await h.refresh();
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  assert.equal(bar.textContent, "— tok/s缓存命中 ——");
  h.window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
});

test("proxy output speed remains available when the native conversation registry is absent", async () => {
  const h = setup(); h.window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
  delete h.window.__codexRoot; h.run(); await drain();
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  assert.equal(bar.querySelector('[data-usage-metric="0"]').textContent, "51.0 tok/s");
  assert.equal(bar.querySelector('[data-usage-metric="1"]').textContent, "缓存命中 —");
  assert.equal(bar.querySelector('[data-usage-metric="2"]').textContent, "—");
  h.window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
});

test("context ring follows the displayed percentage instead of remaining full", async () => {
  const h = setup(); await drain();
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  const progress = bar.querySelector("[data-context-progress]");
  const usage = h.conversations.get("one").latestTokenUsageInfo;
  for (const [used, label, arc] of [[0, "0.0%", "0"], [2910, "29.1%", "29.1"], [10000, "100.0%", "100"]]) {
    usage.last.totalTokens = used;
    await h.refresh();
    assert.equal(bar.querySelector('[data-usage-metric="2"]').textContent, label);
    assert.equal(progress.getAttribute("stroke-dasharray"), `${arc} 100`);
  }
  delete usage.modelContextWindow;
  await h.refresh();
  assert.equal(progress.getAttribute("stroke-dasharray"), "0 100");
  assert.equal(bar.querySelector('[data-usage-metric="2"]').textContent, "—");
  h.window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
});

test("late timing replies cannot overwrite a new request for the same conversation", async () => {
  const h = setup(false); await drain();
  const identity = h.document.querySelector("[data-above-composer-conversation-id]");
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  identity.setAttribute("data-above-composer-conversation-id", "two"); await h.refresh();
  identity.setAttribute("data-above-composer-conversation-id", "one"); await h.refresh();
  assert.equal(h.requests.length, 3);
  h.respond(h.requests[0]); await drain();
  h.respond(h.requests[1]); await drain();
  assert.match(bar.textContent, /^— tok\/s/);
  h.respond(h.requests[2]); await drain();
  assert.match(bar.textContent, /^51.0 tok\/s/);
  h.window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
});

test("timing polls are single-flight, retry after timeout and clear unknown measurements", async () => {
  const h = setup(false); await drain();
  h.setNow(3000); await h.refresh(); assert.equal(h.requests.length, 1);
  h.setNow(12000); await h.refresh(); assert.equal(h.requests.length, 2);
  h.respond(h.requests[1], null); await drain();
  const bar = h.document.querySelector("[data-codex-switch-usage-statusline]");
  assert.match(bar.textContent, /^— tok\/s/);
  h.window.__CODEX_SWITCH_USAGE_STATUSLINE__.dispose();
});
