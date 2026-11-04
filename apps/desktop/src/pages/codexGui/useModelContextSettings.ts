import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "../../api/backend";
import { uiText } from "../../../../../shared/localization/uiText";
import { parseContextCapacity, TOKENS_PER_K } from "../../../../../shared/remote-chat/contextSettings";

export interface ModelContextSettings {
  defaults: Record<string, number>;
  overrides: Record<string, number>;
}
interface Snapshot extends ModelContextSettings { usingCachedDefaults: boolean }
const valuesK = (values: Record<string, number>) => Object.fromEntries(
  Object.entries(values).map(([model, value]) => [model, String(value / TOKENS_PER_K)]),
);

export function useModelContextSettings() {
  const [settings, setSettings] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const pending = useRef(false);
  const revision = useRef(0);
  const load = useCallback(async () => {
    if (pending.current) return;
    const request = ++revision.current;
    setLoading(true); setError("");
    try {
      const snapshot = await invoke<Snapshot>("codex_gui_model_context_settings");
      if (active.current && request === revision.current) {
        setSettings(snapshot); setDraft(valuesK(snapshot.overrides));
      }
    } catch {
      if (active.current && request === revision.current) setError(uiText("client.guiSettings.unableToLoadModelContextSettingsPleaseRetry"));
    } finally {
      if (active.current && request === revision.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    active.current = true; void load();
    return () => { active.current = false; revision.current += 1; };
  }, [load]);

  const save = async (model: string, value: string) => {
    if (!settings || loading || pending.current) return false;
    const capacity = parseContextCapacity(value);
    if (capacity === undefined) {
      setError(uiText("client.errors.enterAContextCapacityBetween1And100000K")); return false;
    }
    if ((settings.overrides[model] ?? null) === capacity) {
      setDraft((current) => ({ ...current, [model]: capacity === null ? "" : String(capacity / TOKENS_PER_K) }));
      setError(""); return true;
    }
    pending.current = true; setSaving(true); setError("");
    try {
      const saved = await invoke<ModelContextSettings>("codex_gui_set_model_context", { model, capacity });
      if (!active.current) return false;
      setSettings((current) => ({ ...saved, usingCachedDefaults: current?.usingCachedDefaults ?? false }));
      setDraft(valuesK(saved.overrides));
      return true;
    } catch {
      if (active.current) setError(uiText("client.guiSettings.modelContextSettingsWereNotSavedPleaseRetry"));
      return false;
    } finally {
      pending.current = false; if (active.current) setSaving(false);
    }
  };
  const change = (model: string, value: string) => setDraft((current) => ({ ...current, [model]: value }));
  const models = settings
    ? [...new Set([...Object.keys(settings.defaults), ...Object.keys(settings.overrides)])].sort() : [];
  return { settings, draft, models, loading, saving, error, load, save, change };
}
