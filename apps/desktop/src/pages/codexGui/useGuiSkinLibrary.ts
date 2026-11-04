import { uiText } from "../../../../../shared/localization/uiText";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  installDreamSkinCommunityTheme, installDreamSkinMarketTheme, loadDreamSkinResourcesStatus,
  loadDreamSkinStatus, loadDreamSkinThemePreview, retryDreamSkinResources,
} from "../../api/backend";
import { BUILT_IN_DREAM_SKIN_IDS } from "../../dreamSkinBuiltIns";
import type { DreamSkinCommunityTheme, DreamSkinMarketTheme, DreamSkinResourcesStatus } from "../../types";
import type { CatalogState } from "../dreamSkin/types";
import { saveGuiSkin, type GuiSkin } from "./guiSkin";

const RESOURCE_REFRESH_MS = 1_000;

function useSkinResources() {
  const [resources, setResources] = useState<DreamSkinResourcesStatus | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await loadDreamSkinResourcesStatus();
        if (disposed) return;
        setResources(next);
        if (!["ready", "error", "unsupported"].includes(next.phase)) {
          timer = window.setTimeout(() => void poll(), RESOURCE_REFRESH_MS);
        }
      } catch {
        if (!disposed) setResources({ phase: "error", installed: false, downloadedBytes: 0 });
      }
    };
    void poll();
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [refresh]);
  const retry = async () => {
    try { setResources(await retryDreamSkinResources()); setRefresh((value) => value + 1); }
    catch { setResources({ phase: "error", installed: false, downloadedBytes: 0 }); }
  };
  return { resources, retry };
}

export function useGuiSkinLibrary(catalog: Pick<CatalogState, "refreshMarket" | "setCommunityThemes">) {
  const resourceState = useSkinResources();
  const [savedThemes, setSavedThemes] = useState<Awaited<ReturnType<typeof loadDreamSkinStatus>>["savedThemes"]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  const refreshSaved = useCallback(async () => {
    try {
      const status = await loadDreamSkinStatus();
      if (mounted.current) setSavedThemes(status.savedThemes.filter((theme) => !BUILT_IN_DREAM_SKIN_IDS.has(theme.id)));
    } catch { if (mounted.current) setError(uiText("client.workspaceActions.couldNotLoadTheSavedThemePleaseTryAgain")); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refreshSaved();
    return () => { mounted.current = false; };
  }, [refreshSaved]);

  const update = (patch: Partial<GuiSkin>) => {
    setError(saveGuiSkin(patch) ? null : uiText("client.workspaceActions.couldNotSaveThemeSettingsPleaseTryAgain"));
  };
  const apply = async (themeId: string, key: string, install?: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(key);
    setError(null);
    try {
      if (install) await install();
      const image = await loadDreamSkinThemePreview(themeId);
      if (!mounted.current) return;
      if (!image) { setError(uiText("client.workspaceActions.couldNotLoadThisThemeSImageChooseItAgain")); return; }
      // Updated community packages keep their theme id, so their image must be reloaded too.
      update({ mode: "custom", themeId, imageRevision: Date.now() });
      if (install) void refreshSaved();
    } catch { if (mounted.current) setError(uiText("client.workspaceActions.couldNotLoadTheThemePleaseTryAgainLater")); }
    finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  const installMarket = (theme: DreamSkinMarketTheme) => {
    const install = theme.installed && !theme.updateAvailable ? undefined : async () => {
      await installDreamSkinMarketTheme(theme.id);
      if (mounted.current) void catalog.refreshMarket();
    };
    void apply(theme.id, `market:${theme.id}`, install);
  };
  const installCommunity = (theme: DreamSkinCommunityTheme) => {
    const install = theme.installed && !theme.updateAvailable ? undefined : async () => {
      await installDreamSkinCommunityTheme(theme.id);
      if (mounted.current) catalog.setCommunityThemes((current) => current.map((entry) => entry.id === theme.id
        ? { ...entry, installed: true, installedVersion: entry.version, updateAvailable: false } : entry));
    };
    void apply(theme.themeId, `community:${theme.id}`, install);
  };
  return { ...resourceState, savedThemes, busy, error, setError, update, refreshSaved, actions: {
    applyTheme: (themeId: string) => { void apply(themeId, `apply:${themeId}`); },
    installAndApplyMarketTheme: installMarket,
    installAndApplyCommunityTheme: installCommunity,
  } };
}
