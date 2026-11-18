// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import bundled from "../data/tokenCostPresets.json";

beforeEach(() => { localStorage.clear(); vi.resetModules(); });

describe("downloaded model pricing", () => {
  it("adds models, updates existing rates and preserves custom rules", async () => {
    const presets = await import("./tokenCostPresets");
    const cost = await import("./tokenCost");
    const model = { ...bundled.models[0], model: "new-model", aliases: ["new-alias"],
      input: 3, cachedInput: 0.3, output: 15, longContextPricing: false, fastModeMultiplier: 4 };
    expect(presets.applyTokenCostPresets({ ...bundled, models: [model] })).toBe(true);
    expect(presets.findTokenCostPreset("new-alias")?.input).toBe(3);
    const entry = { id: "new", ts: 0, provider: "Relay", providerId: "relay", model: "new-model",
      inputTokens: 1_000_000, cachedTokens: 200_000, outputTokens: 100_000, serviceTier: "fast" };
    expect(cost.estimateTokenCost(entry, [])).toBeCloseTo(15.84);
    cost.saveCustomTokenCostRules([{ providerId: "relay", model: "new-model", input: 0, cachedInput: 0, output: 0 }]);
    expect(cost.estimateTokenCost(entry, [])).toBe(0);
    vi.resetModules();
    expect((await import("./tokenCostPresets")).findTokenCostPreset("new-model")?.fastModeMultiplier).toBe(4);
  });

  it("rejects malformed downloads without replacing the last valid cache", async () => {
    const presets = await import("./tokenCostPresets");
    expect(presets.applyTokenCostPresets(bundled)).toBe(true);
    const saved = localStorage.getItem(presets.TOKEN_COST_CATALOG_STORAGE_KEY);
    for (const value of [null, {}, { ...bundled, models: [] },
      ...[0, -1, 101, "3"].map((ultrafastModeMultiplier) => ({
        ...bundled, models: [{ ...bundled.models[0], ultrafastModeMultiplier }],
      })),
      { ...bundled, models: [{ ...bundled.models[0], input: -1 }] },
      { ...bundled, models: [{ ...bundled.models[0], sourceUrl: "javascript:alert(1)" }] },
      { ...bundled, models: [{ ...bundled.models[0], model: "new", aliases: ["gpt-6-sol"] }] }]) {
      expect(presets.applyTokenCostPresets(value)).toBe(false);
      expect(localStorage.getItem(presets.TOKEN_COST_CATALOG_STORAGE_KEY)).toBe(saved);
    }
  });

  it("applies Ultrafast once per request and clears back to standard pricing", async () => {
    const presets = await import("./tokenCostPresets");
    const cost = await import("./tokenCost");
    const fast = await import("./tokenCostFastMode");
    const model = { ...bundled.models[0], model: "priced-model", aliases: ["priced-alias"],
      input: 3, cachedInput: 0.3, output: 15, longContextPricing: true, fastModeMultiplier: 4 };
    const apply = (ultrafastModeMultiplier?: number | null) => expect(presets.applyTokenCostPresets({
      ...bundled, models: [{ ...model, ultrafastModeMultiplier }],
    })).toBe(true);
    apply(2.5);
    presets.saveTokenCostReferenceModel(model.model);
    fast.saveModelFastModeCostMultiplier(model.model, 7);
    const entry = { id: "usage", ts: 1, provider: "", model: "PRICED-ALIAS", serviceTier: "ultrafast",
      inputTokens: 1_000_000, cachedTokens: 200_000, outputTokens: 100_000 };
    // 800k input, 200k cached and 100k output after the long-context adjustment.
    const standard = 4.8 + 0.12 + 2.25;
    expect(cost.estimateTokenCost(entry, [])).toBeCloseTo(standard * 2.5);
    expect(cost.estimateTokenCost({ ...entry, model: "priced-model-dated" }, [])).toBeCloseTo(standard * 2.5);
    expect(cost.estimateTokenCost({ ...entry, serviceTier: "priority" }, [])).toBeCloseTo(standard * 7);
    expect(cost.estimateTokenCost({ ...entry, model: "unlisted-model" }, [])).toBeCloseTo(standard);
    for (const empty of [null, undefined]) {
      apply(empty);
      expect(cost.estimateTokenCost(entry, [])).toBeCloseTo(standard);
    }
  });

  it("uses per-model Fast defaults, overrides, aliases and explicit reset", async () => {
    const fast = await import("./tokenCostFastMode");
    expect(fast.costMultiplierForServiceTier("fast", "gpt-5.5")).toBe(2.5);
    expect(fast.costMultiplierForServiceTier("fast", "gpt-5.6-cyber")).toBe(1);
    fast.saveModelFastModeCostMultiplier("gpt-5.6-cyber", 2.8);
    expect(fast.costMultiplierForServiceTier("fast", "gpt-5.6-cyber")).toBe(2.8);
    expect(fast.costMultiplierForServiceTier("priority", "gpt-6-sol")).toBe(2);
    fast.saveFastModeCostMultiplier(3);
    fast.saveModelFastModeCostMultiplier("gpt-6-sol", 4);
    expect(fast.costMultiplierForServiceTier("fast", "GPT-6-SOL-2026-09-23")).toBe(4);
    expect(fast.costMultiplierForServiceTier("fast", "gpt-6-luna")).toBe(3);
    fast.saveModelFastModeCostMultiplier("gpt-6-sol", null);
    expect(fast.costMultiplierForServiceTier("fast", "gpt-6-sol")).toBe(2);
    expect(fast.costMultiplierForServiceTier("default", "gpt-6-sol")).toBe(1);
  });

  it("fetches once per launch and retains cached data when offline", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("offline"));
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const presets = await import("./tokenCostPresets");
    presets.applyTokenCostPresets(bundled);
    const { refreshTokenCostPresetsOnce } = await import("./tokenCostPresetStartup");
    await Promise.all([refreshTokenCostPresetsOnce(), refreshTokenCostPresetsOnce()]);
    await refreshTokenCostPresetsOnce();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(presets.findTokenCostPreset("gpt-6-luna")?.input).toBe(0.1);
    vi.doUnmock("@tauri-apps/api/core");
  });
});
