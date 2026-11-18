import catalog from "../data/tokenCostPresets.json";
import { findTokenCostPreset, referenceTokenCostPreset } from "./tokenCostPresets";

export const DEFAULT_FAST_MODE_COST_MULTIPLIER = catalog.defaultFastModeCostMultiplier;
export const MAX_FAST_MODE_COST_MULTIPLIER = catalog.maxFastModeCostMultiplier;
export const FAST_MODE_COST_MULTIPLIER_STORAGE_KEY = "codex-switch:fast-mode-cost-multiplier";
export const MODEL_FAST_MODE_COST_STORAGE_KEY = "codex-switch:model-fast-mode-cost-multipliers";
export const FAST_MODE_COST_MULTIPLIER_EVENT = "codex-switch:fast-mode-cost-multiplier-changed";

export function isValidFastModeCostMultiplier(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value > 0 && value <= MAX_FAST_MODE_COST_MULTIPLIER;
}

// Preserve explicitly configured global multipliers from previous versions.
export function loadFastModeCostMultiplier(): number | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(FAST_MODE_COST_MULTIPLIER_STORAGE_KEY) ?? "null");
    return isValidFastModeCostMultiplier(value) ? value : null;
  } catch { return null; }
}

export function saveFastModeCostMultiplier(value: number) {
  if (!isValidFastModeCostMultiplier(value)) return;
  window.localStorage.setItem(FAST_MODE_COST_MULTIPLIER_STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(FAST_MODE_COST_MULTIPLIER_EVENT));
}

export function loadModelFastModeCostMultipliers(): Record<string, number | null> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(MODEL_FAST_MODE_COST_STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([model, multiplier]) => model.length <= 128
      && (multiplier === null || isValidFastModeCostMultiplier(multiplier))));
  } catch { return {}; }
}

export function modelFastModeCostOverride(model: string): number | null {
  const overrides = loadModelFastModeCostMultipliers();
  // A saved null explicitly restores the preset, even when an older global override exists.
  return Object.hasOwn(overrides, model) ? overrides[model] : loadFastModeCostMultiplier();
}

export function saveModelFastModeCostMultiplier(model: string, value: number | null) {
  if (!findTokenCostPreset(model) || (value !== null && !isValidFastModeCostMultiplier(value))) return;
  const overrides = { ...loadModelFastModeCostMultipliers(), [model]: value };
  window.localStorage.setItem(MODEL_FAST_MODE_COST_STORAGE_KEY, JSON.stringify(overrides));
  window.dispatchEvent(new CustomEvent(FAST_MODE_COST_MULTIPLIER_EVENT));
}

export function costMultiplierForServiceTier(serviceTier: string | null | undefined, model: string): number {
  if (serviceTier === "ultrafast") return findTokenCostPreset(model)?.ultrafastModeMultiplier ?? 1;
  if (serviceTier !== "priority" && serviceTier !== "fast") return 1;
  const preset = findTokenCostPreset(model) ?? referenceTokenCostPreset();
  return modelFastModeCostOverride(preset.model) ?? preset.fastModeMultiplier ?? 1;
}
