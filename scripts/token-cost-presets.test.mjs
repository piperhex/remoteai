import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const sourcePaths = {
  "../../../../shared/token-cost-presets": "../shared/token-cost-presets.ts",
  "./tokenCost": "../apps/desktop/src/utils/tokenCost.ts",
  "./tokenCostPresets": "../apps/desktop/src/utils/tokenCostPresets.ts",
  "./tokenCostFastMode": "../apps/desktop/src/utils/tokenCostFastMode.ts",
  "./tokenCostLongContext": "../apps/desktop/src/utils/tokenCostLongContext.ts",
};
const compiled = Object.fromEntries(Object.entries(sourcePaths).map(([name, path]) => [
  name,
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText,
]));
const catalog = JSON.parse(readFileSync(
  new URL("../apps/desktop/src/data/tokenCostPresets.json", import.meta.url), "utf8",
));
const verifiedRates = {
  "gpt-5.4-mini": [0.75, 0.075, 4.5],
  "gpt-5.5": [5, 0.5, 30],
  "gpt-5.6-luna": [0.2, 0.02, 1.2],
  "gpt-5.6-sol": [4, 0.4, 20],
  "gpt-5.6-terra": [2, 0.2, 12],
  "gpt-6-astra": [10, 1, 50],
  "gpt-6-sol": [2, 0.2, 10],
  "gpt-6-luna": [0.1, 0.01, 0.5],
  "gpt-5.3-codex": [1.75, 0.175, 14],
  "gpt-5.6-cyber": [12.5, 1.25, 75],
};

function createHarness({ brokenStorage = false } = {}) {
  const stored = new Map();
  const window = new EventTarget();
  window.localStorage = {
    getItem: key => {
      if (brokenStorage) throw new Error("Storage is unavailable");
      return stored.get(key) ?? null;
    },
    setItem: (key, value) => stored.set(key, value),
  };
  const modules = new Map();
  const require = name => {
    if (name === "../data/tokenCostPresets.json") return structuredClone(catalog);
    if (modules.has(name)) return modules.get(name);
    assert.ok(compiled[name], `Unexpected dependency: ${name}`);
    const exports = {};
    modules.set(name, exports);
    runInNewContext(`(function(require, exports) { ${compiled[name]}\n })`, {
      window, URL, CustomEvent: class extends Event {},
    })(require, exports);
    return exports;
  };
  return {
    window, stored, cost: require("./tokenCost"), presets: require("./tokenCostPresets"),
    fastMode: require("./tokenCostFastMode"),
    longContext: require("./tokenCostLongContext"),
  };
}

function entry(model = "private-model", providerId = "relay") {
  return {
    id: "request", ts: 1, providerId, provider: "Relay", model,
    inputTokens: 1_000_000, cachedTokens: 200_000, outputTokens: 100_000,
  };
}

function provider(overrides = {}) {
  return { id: "relay", name: "Relay", kind: "custom", modelTokenCosts: {}, ...overrides };
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `Expected ${expected}, received ${actual}`);
}

test("contains the verified official presets and a priced Sol default", () => {
  const { presets } = createHarness();
  assert.equal(presets.TOKEN_COST_PRESETS.length, Object.keys(verifiedRates).length);
  for (const [model, rates] of Object.entries(verifiedRates)) {
    const preset = presets.findTokenCostPreset(model);
    assert.ok(preset, model);
    assert.deepEqual([preset.input, preset.cachedInput, preset.output], rates);
    assert.equal(new URL(preset.sourceUrl).hostname, "developers.openai.com");
  }
  assert.equal(presets.DEFAULT_REFERENCE_MODEL, "gpt-5.6-sol");
  assert.equal(presets.referenceTokenCostPreset().model, "gpt-5.6-sol");
});

test("official preset prices apply to custom, OpenAI, and unassociated usage", () => {
  const { cost } = createHarness();
  for (const [model, [input, cachedInput, output]] of Object.entries(verifiedRates)) {
    const expected = ["gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.6-cyber"].includes(model)
      ? 0.8 * input + 0.2 * cachedInput + 0.1 * output
      : 1.6 * input + 0.4 * cachedInput + 0.15 * output;
    closeTo(cost.estimateTokenCost(entry(model), [provider()]), expected);
    closeTo(cost.estimateTokenCost(entry(model), [provider({ kind: "openai" })]), expected);
    closeTo(cost.estimateTokenCost(entry(model, null), []), expected);
  }
});

test("does not use another API's custom price when only the display name matches", () => {
  const { cost } = createHarness();
  const profiles = [provider({ id: "other-api", modelTokenCosts: { "private-model": 9 } })];
  closeTo(cost.estimateTokenCost(entry(), profiles), 9.56);
  closeTo(cost.estimateTokenCost(entry("private-model", null), profiles), 19.35);
});

test("a specific saved model price wins over an earlier inherited price", () => {
  const { cost } = createHarness();
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model: "gpt-5.6-sol", input: 2, cachedInput: 0.5, output: 3 },
    { providerId: "relay", model: "gpt-5.6-sol-dated", input: 9, cachedInput: 1, output: 13 },
  ]);
  closeTo(cost.estimateTokenCost(entry("gpt-5.6-sol-dated"), [provider()]), 16.75);
  closeTo(cost.estimateTokenCost(entry("gpt-5.6-sol"), [provider()]), 3.85);
});

test("custom rules override provider prices and official presets, including zero prices", () => {
  const { cost } = createHarness();
  const model = "gpt-5.6-sol";
  const profiles = [provider({ modelTokenCosts: { [model]: 9 } })];
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model, input: 2, cachedInput: 0.5, output: 3 },
  ]);
  closeTo(cost.estimateTokenCost(entry(model), profiles), 3.85);
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model, input: 0, cachedInput: 0, output: 0 },
  ]);
  assert.equal(cost.estimateTokenCost(entry(model), profiles), 0);
});

test("configured provider model prices take precedence over preset and reference prices", () => {
  const { cost, presets } = createHarness();
  presets.saveTokenCostReferenceModel("gpt-6-astra");
  for (const model of ["gpt-5.6-sol", "private-model"]) {
    closeTo(cost.estimateTokenCost(entry(model), [provider({ modelTokenCosts: { [model]: 2 } })]), 4.3);
    assert.equal(cost.estimateTokenCost(entry(model), [provider({ modelTokenCosts: { [model]: 0 } })]), 0);
  }
});

test("unknown models use Sol by default and update immediately when the reference changes", () => {
  const { cost, presets, window } = createHarness();
  let changes = 0;
  window.addEventListener(presets.TOKEN_COST_REFERENCE_MODEL_EVENT, () => { changes += 1; });
  closeTo(cost.estimateTokenCost(entry(), [provider()]), 9.56);
  closeTo(cost.estimateTokenCost(entry("private-model", null), []), 9.56);
  presets.saveTokenCostReferenceModel("gpt-5.6-terra");
  assert.equal(changes, 1);
  assert.equal(presets.loadTokenCostReferenceModel(), "gpt-5.6-terra");
  closeTo(cost.estimateTokenCost(entry(), [provider()]), 5.08);
  closeTo(cost.estimateTokenCost(entry("private-model", null), []), 5.08);
  closeTo(cost.estimateTokenCost(entry("gpt-5.6-sol"), [provider()]), 9.56);
});

test("Spark is unpriced and uses an explicitly selected reference rather than another Codex price", () => {
  const { cost, presets } = createHarness();
  const spark = "gpt-5.3-codex-spark";
  assert.ok(presets.UNPRICED_PRESET_MODELS.includes(spark));
  assert.equal(presets.findTokenCostPreset(spark), undefined);
  closeTo(cost.estimateTokenCost(entry(spark), [provider()]), 9.56);
  presets.saveTokenCostReferenceModel("gpt-5.6-terra");
  closeTo(cost.estimateTokenCost(entry(spark), [provider()]), 5.08);
  presets.saveTokenCostReferenceModel(spark);
  assert.equal(presets.loadTokenCostReferenceModel(), "gpt-5.6-terra");
});

test("invalid or unreadable saved prices and references fall back to Sol", () => {
  for (const invalid of ["not-a-model", "gpt-5.3-codex-spark", "{invalid json"]) {
    const { cost, presets, stored } = createHarness();
    stored.set(presets.TOKEN_COST_REFERENCE_MODEL_STORAGE_KEY, invalid);
    stored.set(cost.TOKEN_COST_CUSTOM_RULES_STORAGE_KEY, invalid);
    assert.equal(presets.loadTokenCostReferenceModel(), "gpt-5.6-sol");
    closeTo(cost.estimateTokenCost(entry(), [provider()]), 9.56);
  }
  const { cost, presets } = createHarness({ brokenStorage: true });
  assert.equal(presets.loadTokenCostReferenceModel(), "gpt-5.6-sol");
  closeTo(cost.estimateTokenCost(entry(), [provider()]), 9.56);
});

test("versioned preset models retain their most specific price", () => {
  const { cost, presets } = createHarness();
  for (const model of ["gpt-5.4-mini", "gpt-5.5", "gpt-5.6-sol"]) {
    const versioned = ` ${model.toUpperCase()}-2026-09-01 `;
    assert.equal(presets.findTokenCostPreset(versioned).model, model);
    const [input, cachedInput, output] = verifiedRates[model];
    const expected = ["gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.6-cyber"].includes(model)
      ? 0.8 * input + 0.2 * cachedInput + 0.1 * output
      : 1.6 * input + 0.4 * cachedInput + 0.15 * output;
    closeTo(cost.estimateTokenCost(entry(versioned), [provider()]), expected);
  }
});

test("the GPT-5.6 alias retains Sol pricing when the fallback reference changes", () => {
  const { cost, presets } = createHarness();
  presets.saveTokenCostReferenceModel("gpt-5.6-terra");
  assert.equal(presets.findTokenCostPreset("gpt-5.6").model, "gpt-5.6-sol");
  closeTo(cost.estimateTokenCost(entry("gpt-5.6"), [provider()]), 9.56);
});

test("versioned model names still use provider-specific custom rules", () => {
  const { cost } = createHarness();
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model: "gpt-5.6-sol", input: 2, cachedInput: 0.5, output: 3 },
  ]);
  closeTo(cost.estimateTokenCost(entry("GPT-5.6-SOL-2026-09-01"), [provider()]), 3.85);
});

test("fast requests use a default model multiplier for priority and fast tier names", () => {
  const { cost, fastMode } = createHarness();
  assert.equal(fastMode.DEFAULT_FAST_MODE_COST_MULTIPLIER, 2);
  assert.equal(fastMode.MAX_FAST_MODE_COST_MULTIPLIER, 100);
  assert.equal(fastMode.loadFastModeCostMultiplier(), null);
  for (const serviceTier of ["priority", "fast"]) {
    closeTo(cost.estimateTokenCost({ ...entry("gpt-5.6-sol"), serviceTier }, [provider()]), 19.12);
  }
});

test("changing the multiplier recalculates fast entries without changing normal or legacy entries", () => {
  const { cost, fastMode, window } = createHarness();
  let changes = 0;
  window.addEventListener(fastMode.FAST_MODE_COST_MULTIPLIER_EVENT, () => { changes += 1; });
  fastMode.saveFastModeCostMultiplier(3);
  assert.equal(changes, 1);
  assert.equal(fastMode.loadFastModeCostMultiplier(), 3);
  closeTo(cost.estimateTokenCost({ ...entry(), serviceTier: "priority" }, [provider()]), 28.68);
  for (const serviceTier of ["default", "auto", "flex", "unknown", "", null, undefined]) {
    closeTo(cost.estimateTokenCost({ ...entry(), serviceTier }, [provider()]), 9.56);
  }
});

test("mixed normal, fast, and legacy usage is priced separately for each request", () => {
  const { cost } = createHarness();
  const entries = [
    { ...entry(), serviceTier: "default" },
    { ...entry(), serviceTier: "priority" },
    { ...entry(), serviceTier: "fast" },
    entry(),
  ];
  const total = entries.reduce((sum, usage) => sum + cost.estimateTokenCost(usage, [provider()]), 0);
  closeTo(total, 57.36);
});

test("fast multipliers apply after preset, provider, custom-rule, and reference prices", () => {
  const { cost, fastMode, presets } = createHarness();
  fastMode.saveFastModeCostMultiplier(3);
  const fast = model => ({ ...entry(model), serviceTier: "priority" });
  closeTo(cost.estimateTokenCost(fast("gpt-5.6-sol"), [provider()]), 28.68);
  closeTo(cost.estimateTokenCost(fast("gpt-5.6-sol"), [provider({ kind: "openai" })]), 28.68);
  closeTo(cost.estimateTokenCost(fast("private-model"), [provider({
    modelTokenCosts: { "private-model": 2 },
  })]), 12.9);
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model: "custom-priced", input: 2, cachedInput: 0.5, output: 3 },
  ]);
  closeTo(cost.estimateTokenCost(fast("custom-priced"), [provider()]), 11.55);
  presets.saveTokenCostReferenceModel("gpt-5.6-terra");
  closeTo(cost.estimateTokenCost(fast("unknown-model"), [provider()]), 15.24);
});

test("zero-cost provider prices and custom rules stay zero for fast requests", () => {
  const { cost, fastMode } = createHarness();
  fastMode.saveFastModeCostMultiplier(100);
  const fast = { ...entry(), serviceTier: "priority" };
  assert.equal(cost.estimateTokenCost(fast, [provider({ modelTokenCosts: { "private-model": 0 } })]), 0);
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model: "private-model", input: 0, cachedInput: 0, output: 0 },
  ]);
  assert.equal(cost.estimateTokenCost(fast, [provider()]), 0);
});

test("invalid multiplier values cannot replace a saved valid multiplier", () => {
  const { fastMode } = createHarness();
  assert.equal(fastMode.isValidFastModeCostMultiplier(2.5), true);
  assert.equal(fastMode.isValidFastModeCostMultiplier(100), true);
  fastMode.saveFastModeCostMultiplier(3);
  for (const value of [0, -1, 101, Infinity, NaN, "3", null, undefined]) {
    assert.equal(fastMode.isValidFastModeCostMultiplier(value), false);
    fastMode.saveFastModeCostMultiplier(value);
    assert.equal(fastMode.loadFastModeCostMultiplier(), 3);
  }
});

test("malformed and inaccessible multiplier storage uses the default fast multiplier", () => {
  for (const invalid of ["", "not-a-number", "{invalid", "0", "-1", "101", "Infinity", "NaN"]) {
    const { cost, fastMode, stored } = createHarness();
    stored.set(fastMode.FAST_MODE_COST_MULTIPLIER_STORAGE_KEY, invalid);
    assert.equal(fastMode.loadFastModeCostMultiplier(), null);
    closeTo(cost.estimateTokenCost({ ...entry(), serviceTier: "priority" }, [provider()]), 19.12);
  }
  const { cost, fastMode } = createHarness({ brokenStorage: true });
  assert.equal(fastMode.loadFastModeCostMultiplier(), null);
  closeTo(cost.estimateTokenCost({ ...entry(), serviceTier: "priority" }, [provider()]), 19.12);
});

test("estimating fast-mode costs does not mutate token counts or the usage entry", () => {
  const { cost } = createHarness();
  const usage = Object.freeze({ ...entry(), serviceTier: "priority", totalTokens: 1_100_000 });
  const before = structuredClone(usage);
  closeTo(cost.estimateTokenCost(usage, [provider()]), 19.12);
  assert.deepEqual(usage, before);
});

test("long context starts strictly above 272000 input tokens including cache", () => {
  const { cost, longContext } = createHarness();
  assert.deepEqual(structuredClone(longContext.loadLongContextCostSettings()), {
    enabled: true, thresholdTokens: 272_000, inputMultiplier: 2, cachedInputMultiplier: 2, outputMultiplier: 1.5,
  });
  const usage = { ...entry("gpt-5.6-sol"), cachedTokens: 200_000, outputTokens: 1_000 };
  closeTo(cost.estimateTokenCost({ ...usage, inputTokens: 271_999 }, []), 0.387996);
  closeTo(cost.estimateTokenCost({ ...usage, inputTokens: 272_000 }, []), 0.388);
  closeTo(cost.estimateTokenCost({ ...usage, inputTokens: 272_001 }, []), 0.766008);
  closeTo(cost.estimateTokenCost({ ...usage, inputTokens: 300_000 }, []), 0.99);
});

test("output and cumulative tokens do not turn short requests into long requests", () => {
  const { cost } = createHarness();
  const usage = { ...entry(), inputTokens: 200_000, cachedTokens: 0, outputTokens: 100_000 };
  closeTo(cost.estimateTokenCost({ ...usage, totalTokens: 2_000_000, modelContextWindow: 1_050_000 }, []), 2.8);
  for (const inputTokens of [null, undefined, 0]) {
    closeTo(cost.estimateTokenCost({ ...usage, inputTokens }, []), 2);
  }
  const total = [usage, usage].reduce((sum, item) => sum + cost.estimateTokenCost(item, []), 0);
  closeTo(total, 5.6);
});

test("mixed short and long requests stack fast costs separately without changing usage", () => {
  const { cost } = createHarness();
  const base = { ...entry(), cachedTokens: 200_000, outputTokens: 1_000 };
  const entries = [
    Object.freeze({ ...base, inputTokens: 272_000 }),
    Object.freeze({ ...base, inputTokens: 300_000 }),
    Object.freeze({ ...base, inputTokens: 300_000, serviceTier: "fast" }),
  ];
  const before = structuredClone(entries);
  closeTo(entries.reduce((sum, item) => sum + cost.estimateTokenCost(item, []), 0), 3.358);
  assert.deepEqual(entries, before);
});

test("context threshold and each cost component multiplier are independently configurable", () => {
  const { cost, longContext, window } = createHarness();
  let changes = 0;
  window.addEventListener(longContext.LONG_CONTEXT_COST_EVENT, () => { changes += 1; });
  const settings = { enabled: true, thresholdTokens: 300_000,
    inputMultiplier: 3, cachedInputMultiplier: 4, outputMultiplier: 2 };
  longContext.saveLongContextCostSettings(settings);
  assert.equal(changes, 1);
  const usage = { ...entry(), inputTokens: 300_000, cachedTokens: 200_000, outputTokens: 1_000 };
  closeTo(cost.estimateTokenCost(usage, []), 0.5);
  closeTo(cost.estimateTokenCost({ ...usage, inputTokens: 300_001 }, []), 1.560012);
  closeTo(cost.estimateTokenCost({ ...usage, inputTokens: 300_001, serviceTier: "priority" }, []), 3.120024);
  longContext.saveLongContextCostSettings({ ...settings, enabled: false });
  closeTo(cost.estimateTokenCost(entry(), []), 5.28);
});

test("known models follow their own context policy and unknown models inherit the reference policy", () => {
  const { cost, presets } = createHarness();
  presets.saveTokenCostReferenceModel("gpt-5.4-mini");
  closeTo(cost.estimateTokenCost(entry("private-model"), []), 1.065);
  closeTo(cost.estimateTokenCost(entry("gpt-5.6-sol"), []), 9.56);
  closeTo(cost.estimateTokenCost(entry("gpt-5.4-mini"), []), 1.065);
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model: "gpt-5.4-mini", input: 2, cachedInput: 0.5, output: 3 },
    { providerId: "relay", model: "private-model", input: 2, cachedInput: 0.5, output: 3 },
  ]);
  closeTo(cost.estimateTokenCost(entry("gpt-5.4-mini"), []), 2);
  closeTo(cost.estimateTokenCost(entry("private-model"), []), 2);
  presets.saveTokenCostReferenceModel("gpt-5.6-sol");
  closeTo(cost.estimateTokenCost(entry("private-model"), []), 3.85);
  closeTo(cost.estimateTokenCost(entry("gpt-5.4-mini"), []), 2);
});

test("invalid long-context settings never replace valid settings, even when disabled", () => {
  const { longContext } = createHarness();
  const defaults = { ...longContext.DEFAULT_LONG_CONTEXT_COST_SETTINGS };
  for (const invalid of [null, [], {}, { ...defaults, enabled: "true" },
    ...[0, -1, 1.5, 1_000_000_001, NaN, Infinity, "272000"].map(thresholdTokens => ({ ...defaults, thresholdTokens })),
    ...["inputMultiplier", "cachedInputMultiplier", "outputMultiplier"].flatMap(key =>
      [0, -1, 101, NaN, Infinity, "2"].map(value => ({ ...defaults, [key]: value }))),
    { ...defaults, enabled: false, outputMultiplier: 0 }]) {
    assert.equal(longContext.isValidLongContextCostSettings(invalid), false);
    longContext.saveLongContextCostSettings(invalid);
    assert.deepEqual(structuredClone(longContext.loadLongContextCostSettings()), defaults);
  }
  const limits = { ...defaults, thresholdTokens: 1_000_000_000, inputMultiplier: 100,
    cachedInputMultiplier: 0.01, outputMultiplier: 100 };
  assert.equal(longContext.isValidLongContextCostSettings(limits), true);
  longContext.saveLongContextCostSettings(limits);
  assert.deepEqual(structuredClone(longContext.loadLongContextCostSettings()), limits);
});

test("malformed and unavailable context settings storage uses official defaults", () => {
  for (const invalid of ["", "{invalid", "null", "{}", "[]", "false"]) {
    const { cost, longContext, stored } = createHarness();
    stored.set(longContext.LONG_CONTEXT_COST_STORAGE_KEY, invalid);
    assert.equal(longContext.loadLongContextCostSettings().thresholdTokens, 272_000);
    closeTo(cost.estimateTokenCost(entry(), []), 9.56);
  }
  const { cost } = createHarness({ brokenStorage: true });
  closeTo(cost.estimateTokenCost(entry(), []), 9.56);
});
