import { invoke } from "@tauri-apps/api/core";
import {
  loadStoredModelTokenCosts,
  MODEL_TOKEN_COSTS_EVENT,
  MODEL_TOKEN_COSTS_STORAGE_KEY,
} from "../pages/providers/providerUtils";
import {
  invalidateCustomTokenCostRulesCache,
  loadCustomTokenCostRules,
  loadTokenCostDisplaySettings,
  TOKEN_COST_DISPLAY_EVENT,
  TOKEN_COST_DISPLAY_STORAGE_KEY,
  TOKEN_COST_CUSTOM_RULES_EVENT,
  TOKEN_COST_CUSTOM_RULES_STORAGE_KEY,
} from "./tokenCost";
import {
  loadTokenCostReferenceModel,
  currentTokenCostCatalog,
  TOKEN_COST_REFERENCE_MODEL_EVENT,
  TOKEN_COST_REFERENCE_MODEL_STORAGE_KEY,
} from "./tokenCostPresets";
import {
  FAST_MODE_COST_MULTIPLIER_EVENT,
  FAST_MODE_COST_MULTIPLIER_STORAGE_KEY,
  loadFastModeCostMultiplier,
  loadModelFastModeCostMultipliers,
  MODEL_FAST_MODE_COST_STORAGE_KEY,
} from "./tokenCostFastMode";
import {
  LONG_CONTEXT_COST_EVENT,
  LONG_CONTEXT_COST_STORAGE_KEY,
  loadLongContextCostSettings,
} from "./tokenCostLongContext";

const RETRY_DELAY_MS = 30_000;

function createCostRatesSynchronizer() {
  let active = true;
  let running = false;
  let pending = false;
  let retryTimer: number | undefined;

  const sync = async () => {
    pending = true;
    if (running || !active) return;
    running = true;
    window.clearTimeout(retryTimer);
    try {
      while (pending && active) {
        pending = false;
        await invoke("set_codex_usage_cost_rates", {
          rates: {
            display: loadTokenCostDisplaySettings(),
            customRules: loadCustomTokenCostRules(),
            modelTokenCosts: loadStoredModelTokenCosts(),
            referenceModel: loadTokenCostReferenceModel(),
            fastModeMultiplier: loadFastModeCostMultiplier(),
            modelFastModeMultipliers: loadModelFastModeCostMultipliers(),
            presetCatalog: currentTokenCostCatalog(),
            longContext: loadLongContextCostSettings(),
          },
        });
      }
    } catch {
      console.warn("Unable to update estimated costs in Codex; retrying shortly.");
      if (active) retryTimer = window.setTimeout(() => void sync(), RETRY_DELAY_MS);
    } finally {
      running = false;
    }
  };

  return {
    sync: () => void sync(),
    stop: () => {
      active = false;
      window.clearTimeout(retryTimer);
    },
  };
}

// The main window remains available while hidden and receives changes from auxiliary windows.
export function installCodexUsageCostSync() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const synchronizer = createCostRatesSynchronizer();
  const handleChange = synchronizer.sync;
  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    if (event.key !== null && event.key !== TOKEN_COST_CUSTOM_RULES_STORAGE_KEY
      && event.key !== TOKEN_COST_DISPLAY_STORAGE_KEY
      && event.key !== MODEL_TOKEN_COSTS_STORAGE_KEY && event.key !== TOKEN_COST_REFERENCE_MODEL_STORAGE_KEY
      && event.key !== MODEL_FAST_MODE_COST_STORAGE_KEY
      && event.key !== FAST_MODE_COST_MULTIPLIER_STORAGE_KEY && event.key !== LONG_CONTEXT_COST_STORAGE_KEY) return;
    invalidateCustomTokenCostRulesCache();
    handleChange();
  };
  window.addEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, handleChange);
  window.addEventListener(TOKEN_COST_DISPLAY_EVENT, handleChange);
  window.addEventListener(MODEL_TOKEN_COSTS_EVENT, handleChange);
  window.addEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, handleChange);
  window.addEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, handleChange);
  window.addEventListener(LONG_CONTEXT_COST_EVENT, handleChange);
  window.addEventListener("storage", handleStorage);
  handleChange();
  return () => {
    synchronizer.stop();
    window.removeEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, handleChange);
    window.removeEventListener(TOKEN_COST_DISPLAY_EVENT, handleChange);
    window.removeEventListener(MODEL_TOKEN_COSTS_EVENT, handleChange);
    window.removeEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, handleChange);
    window.removeEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, handleChange);
    window.removeEventListener(LONG_CONTEXT_COST_EVENT, handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}
