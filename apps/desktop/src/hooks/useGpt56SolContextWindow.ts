import { useCallback, useEffect, useState } from "react";
import {
  loadOfficialModelContextSettings,
  MAX_GPT_5_6_SOL_CONTEXT_WINDOW,
  MIN_GPT_5_6_SOL_CONTEXT_WINDOW,
  type OfficialModelContextSettings,
  subscribeToProviderEvents,
  updateOfficialModelContextWindow,
} from "../api/backend";

export const GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS_K = [128, 272, 384, 400, 1000] as const;

function parseContextWindowK(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const contextWindow = Number(trimmed) * 1_000;
  return Number.isSafeInteger(contextWindow)
    && contextWindow >= MIN_GPT_5_6_SOL_CONTEXT_WINDOW
    && contextWindow <= MAX_GPT_5_6_SOL_CONTEXT_WINDOW
    ? contextWindow
    : null;
}

export function useGpt56SolContextWindow() {
  const [saving, setSaving] = useState(true);
  const [error, setError] = useState<"save" | null>(null);
  const [modelValuesK, setModelValuesK] = useState<Record<string, string>>({});
  const [defaultValuesK, setDefaultValuesK] = useState<Record<string, string>>({});
  const [models, setModels] = useState<string[]>([]);
  const applySettings = useCallback((settings: OfficialModelContextSettings) => {
    setModels(settings.models);
    setDefaultValuesK(Object.fromEntries(Object.entries(settings.defaultContextWindows ?? {})
      .map(([model, value]) => [model, String(value / 1_000)])));
    setModelValuesK(Object.fromEntries(Object.entries(settings.modelContextWindows)
      .map(([model, value]) => [model, String(value / 1_000)])));
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => loadOfficialModelContextSettings()
      .then((settings) => {
        if (!active) return;
        applySettings(settings);
      })
      .catch(() => {
        if (active) setError("save");
      })
      .finally(() => {
        if (active) setSaving(false);
      });
    void load();
    const unsubscribe = subscribeToProviderEvents(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySettings]);

  const saveModelValueK = useCallback(async (model: string, candidate: string) => {
    const contextWindow = parseContextWindowK(candidate);
    if (contextWindow === null) return false;
    try {
      const settings = await updateOfficialModelContextWindow(model, contextWindow);
      applySettings(settings);
      return true;
    } catch {
      return false;
    }
  }, [applySettings]);

  const updateModelValueK = useCallback((model: string, valueK: string) => {
    if (/^\d*$/.test(valueK)) setModelValuesK((current) => ({ ...current, [model]: valueK }));
  }, []);

  const clearModelValue = useCallback(async (model: string) => {
    try {
      const settings = await updateOfficialModelContextWindow(model, null);
      applySettings(settings);
    } catch {
      // The panel keeps the previous value when persistence fails.
    }
  }, [applySettings]);

  return {
    saving,
    error,
    modelValuesK,
    defaultValuesK,
    models,
    saveModelValueK,
    updateModelValueK,
    clearModelValue,
  };
}
