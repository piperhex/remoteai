import { uiText } from "../../../../../shared/localization/uiText";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "../../api/backend";
import type { GuiSystemPromptSettings, SettingsStore } from '../../../../../shared/remote-chat/guiSettings';

export type { GuiSystemPromptSettings } from '../../../../../shared/remote-chat/guiSettings';

const localSettings: SettingsStore<GuiSystemPromptSettings> = {
  read: () => invoke('codex_gui_system_prompt_settings'),
  write: (settings) => invoke('codex_gui_set_system_prompt_settings', { settings }),
};

export function useGuiSystemPrompts(api = localSettings) {
  const [settings, setSettings] = useState<GuiSystemPromptSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const pending = useRef(false);
  const load = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    setError("");
    try {
      const saved = await api.read();
      if (request === revision.current) setSettings(saved);
    } catch {
      if (request === revision.current) setError(uiText("client.workspaceActions.couldNotLoadTheSystemPromptPleaseTryAgain"));
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
    return () => { revision.current += 1; };
  }, [load]);
  const update = async (patch: Partial<GuiSystemPromptSettings>) => {
    if (!settings || loading || pending.current) return false;
    const request = ++revision.current;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await api.write({ ...settings, ...patch });
      if (request !== revision.current) return false;
      setSettings(saved);
      return true;
    } catch {
      if (request === revision.current) setError(uiText("client.workspaceActions.couldNotSaveTheSystemPromptPleaseTryAgain"));
      return false;
    } finally {
      pending.current = false;
      if (request === revision.current) setSaving(false);
    }
  };
  return { settings, loading, saving, error, load, update };
}
