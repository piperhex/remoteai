import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const hookSource = ts.transpileModule(readFileSync(new URL(
  "../apps/desktop/src/pages/providers/useProviderTokenUsage.ts", import.meta.url,
), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const LONG_CONTEXT_EVENT = "long-context-settings-changed";
const LONG_CONTEXT_STORAGE_KEY = "long-context-settings";
const drainMicrotasks = () => new Promise(resolve => setImmediate(resolve));

function createWindowHarness() {
  const intervals = new Map();
  const listeners = new Map();
  let timerId = 0;
  const window = new EventTarget();
  window.localStorage = {};
  window.setInterval = (callback, delay) => {
    intervals.set(++timerId, { callback, delay });
    return timerId;
  };
  window.clearInterval = id => intervals.delete(id);
  const addListener = window.addEventListener.bind(window);
  const removeListener = window.removeEventListener.bind(window);
  window.addEventListener = (name, callback) => {
    const callbacks = listeners.get(name) ?? new Set();
    callbacks.add(callback);
    listeners.set(name, callbacks);
    addListener(name, callback);
  };
  window.removeEventListener = (name, callback) => {
    listeners.get(name)?.delete(callback);
    removeListener(name, callback);
  };
  return {
    window, intervals,
    listenerCount: () => [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0),
  };
}

function createHookDependencies(state) {
  return {
    react: {
      useState: initial => [initial, value => state.updates.push(value)],
      useMemo: factory => factory(),
      useEffect: effect => { state.cleanup = effect(); },
    },
    "../../api/backend": {
      loadProviderTokenUsage: (startTs, providers) => {
        state.activeRequests += 1;
        state.maxActiveRequests = Math.max(state.maxActiveRequests, state.activeRequests);
        return new Promise((resolve, reject) => state.calls.push({ startTs, providers, resolve, reject }))
          .finally(() => { state.activeRequests -= 1; });
      },
      subscribeToTokenUsageChanges: callback => {
        state.subscription = callback;
        return () => { state.subscription = undefined; state.unsubscribed += 1; };
      },
    },
    "../../utils/providerTokenUsage": { createProviderTokenUsageLookup: entries => entries },
    "../../utils/tokenCost": {
      TOKEN_COST_CUSTOM_RULES_EVENT: "custom-rules-changed",
      invalidateCustomTokenCostRulesCache: () => { state.invalidations += 1; },
    },
    "../../utils/tokenCostPresets": { TOKEN_COST_REFERENCE_MODEL_EVENT: "reference-changed" },
    "../../utils/tokenCostFastMode": {
      FAST_MODE_COST_MULTIPLIER_EVENT: "fast-mode-changed",
      FAST_MODE_COST_MULTIPLIER_STORAGE_KEY: "fast-mode-settings",
    },
    "../../utils/tokenCostLongContext": {
      LONG_CONTEXT_COST_EVENT: LONG_CONTEXT_EVENT,
      LONG_CONTEXT_COST_STORAGE_KEY: LONG_CONTEXT_STORAGE_KEY,
    },
  };
}

function createHarness() {
  const { window, intervals, listenerCount } = createWindowHarness();
  const state = {
    calls: [], updates: [], activeRequests: 0, maxActiveRequests: 0, unsubscribed: 0, invalidations: 0,
  };
  const dependencies = createHookDependencies(state);
  const exports = {};
  runInNewContext(`(function(require, exports) { ${hookSource}\n })`, { window })(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  const providers = [{ id: "relay", name: "Relay", kind: "custom" }];
  exports.useProviderTokenUsage(2, providers, true);
  return {
    calls: state.calls, updates: state.updates, providers, intervals,
    emitSettings: () => window.dispatchEvent(new Event(LONG_CONTEXT_EVENT)),
    emitUsage: () => state.subscription?.(),
    emitStorage: (key = LONG_CONTEXT_STORAGE_KEY, storageArea = window.localStorage) => {
      const event = new Event("storage");
      Object.assign(event, { key, storageArea });
      window.dispatchEvent(event);
    },
    tick: () => [...intervals.values()].forEach(({ callback }) => callback()),
    cleanup: () => state.cleanup(),
    get activeRequests() { return state.activeRequests; },
    get maxActiveRequests() { return state.maxActiveRequests; },
    get invalidations() { return state.invalidations; },
    get unsubscribed() { return state.unsubscribed; },
    get listenerCount() { return listenerCount(); },
  };
}

test("long-context changes and polling stay single-flight while a provider request is pending", async () => {
  const harness = createHarness();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].providers, harness.providers);
  assert.equal([...harness.intervals.values()][0].delay, 2_000);
  for (let index = 0; index < 4; index += 1) {
    harness.tick();
    harness.emitUsage();
    harness.emitSettings();
    harness.emitStorage();
  }
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.maxActiveRequests, 1);
  const totals = [{ providerId: "relay", todayEstimatedCost: 3 }];
  harness.calls[0].resolve(totals);
  await drainMicrotasks();
  assert.equal(harness.updates[0], totals);
  assert.equal(harness.activeRequests, 0);
  harness.emitSettings();
  assert.equal(harness.calls.length, 2);
  harness.tick();
  harness.emitSettings();
  assert.equal(harness.calls.length, 2);
  harness.calls[1].resolve([]);
  await drainMicrotasks();
  harness.tick();
  assert.equal(harness.calls.length, 3);
  assert.equal(harness.maxActiveRequests, 1);
  harness.cleanup();
  harness.calls[2].resolve([]);
  await drainMicrotasks();
});

test("cross-window long-context settings refresh an idle view and ignore unrelated storage", async () => {
  const harness = createHarness();
  harness.calls[0].resolve([]);
  await drainMicrotasks();
  harness.emitStorage("unrelated-setting");
  harness.emitStorage(LONG_CONTEXT_STORAGE_KEY, {});
  assert.equal(harness.calls.length, 1);
  harness.emitStorage();
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.invalidations, 1);
  harness.calls[1].reject(new Error("Statistics temporarily unavailable"));
  await drainMicrotasks();
  assert.equal(harness.updates.length, 1);
  harness.emitSettings();
  assert.equal(harness.calls.length, 3);
  assert.equal(harness.maxActiveRequests, 1);
  harness.cleanup();
  harness.calls[2].resolve([]);
  await drainMicrotasks();
});

test("unmount clears polling and settings listeners and ignores a late provider response", async () => {
  const harness = createHarness();
  assert.ok(harness.listenerCount > 0);
  harness.cleanup();
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.listenerCount, 0);
  assert.equal(harness.unsubscribed, 1);
  harness.tick();
  harness.emitSettings();
  harness.emitStorage();
  harness.emitUsage();
  assert.equal(harness.calls.length, 1);
  harness.calls[0].resolve([{ providerId: "relay", todayEstimatedCost: 4 }]);
  await drainMicrotasks();
  assert.equal(harness.updates.length, 0);
  assert.equal(harness.activeRequests, 0);
});
