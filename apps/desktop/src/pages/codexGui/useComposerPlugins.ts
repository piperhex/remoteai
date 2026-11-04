import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useState } from "react";
import { guiApi } from "../../../../../shared/conversation/api";
import type { ComposerPlugin, PluginsResponse } from "../../../../../shared/conversation/attachmentTypes";

export function useComposerPlugins({ cwd, active }: { cwd: string; active: boolean }) {
  const [result, setResult] = useState({ cwd, plugins: [] as ComposerPlugin[], loading: false, error: "" });
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setResult({ cwd, plugins: [], loading: true, error: "" });
    void guiApi.request<PluginsResponse>({ operation: "plugins", cwd: cwd || undefined }).then((response) => {
      if (cancelled) return;
      const plugins = [...new Map(response.marketplaces.flatMap((marketplace) => marketplace.plugins)
        .filter((plugin) => plugin.installed && plugin.enabled).map((plugin) => [plugin.id, plugin])).values()];
      setResult({ cwd, plugins, loading: false,
        error: response.marketplaceLoadErrors.length ? uiText("client.workspaceActions.somePluginsCouldNotLoadReopenTheMenuToRetry") : "" });
    }).catch(() => {
      if (!cancelled) setResult({ cwd, plugins: [], loading: false, error: uiText("client.workspaceActions.pluginsAreUnavailableReopenTheMenuToRetry") });
    });
    return () => { cancelled = true; };
  }, [cwd, active]);
  return result.cwd === cwd ? result : { plugins: [], loading: active, error: "" };
}
