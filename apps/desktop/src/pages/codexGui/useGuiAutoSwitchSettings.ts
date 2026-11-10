import { uiText } from "../../../../../shared/localization/uiText";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadGuiAutoSwitchSettings, saveGuiAutoSwitchSettings, updateGuiAccountRule } from "../../../../../shared/conversation/autoSwitchSettings";
import type { GuiAutoSwitchAccountRule, GuiAutoSwitchSettings } from "../../../../../shared/conversation/autoSwitchSettings";
import type { SettingsStore } from '../../../../../shared/remote-chat/guiSettings';

const localSettings = { read: loadGuiAutoSwitchSettings, write: saveGuiAutoSwitchSettings };

export function useGuiAutoSwitchSettings(api: SettingsStore<GuiAutoSwitchSettings> = localSettings) {
  const [settings, setSettings] = useState<GuiAutoSwitchSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const revision = useRef(0);
  const pendingSave = useRef(false);
  const load = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    setError("");
    try {
      const saved = await api.read();
      if (request === revision.current) { setSettings(saved); setDirty(false); }
    } catch {
      if (request === revision.current) setError(uiText("client.workspaceActions.couldNotLoadSettingsPleaseTryAgain"));
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
    return () => { revision.current += 1; };
  }, [load]);
  const save = async (availableAccountIds: readonly string[]) => {
    if (!settings || loading || pendingSave.current) return false;
    const request = ++revision.current;
    pendingSave.current = true;
    setSaving(true);
    setError("");
    try {
      const available = new Set(availableAccountIds);
      const saved = await api.write({ ...settings,
        accounts: settings.accounts.filter((rule) => available.has(rule.accountId)) });
      if (request !== revision.current) return false;
      setSettings(saved);
      setDirty(false);
      return true;
    } catch {
      if (request === revision.current) setError(uiText("client.workspaceActions.couldNotSaveSettingsPleaseTryAgain"));
      return false;
    } finally {
      pendingSave.current = false;
      if (request === revision.current) setSaving(false);
    }
  };
  const update = (patch: Partial<GuiAutoSwitchSettings>) => {
    setDirty(true);
    setSettings((current) => current ? { ...current, ...patch } : current);
  };
  const updateAccount = (rule: GuiAutoSwitchAccountRule) => {
    setDirty(true);
    setSettings((current) => current ? updateGuiAccountRule(current, rule) : current);
  };
  return { settings, loading, saving, dirty, error, load, save, update, updateAccount };
}
