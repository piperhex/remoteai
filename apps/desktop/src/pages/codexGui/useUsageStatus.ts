import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useRef, useState } from "react";
import { invoke } from "../../api/backend";
import { USAGE_REFRESH_INTERVAL_MS, type UsageSummary } from "../../../../../shared/remote-chat/usage";
import { decodeUsageSummary } from "../../../../../shared/remote-chat/usageSummary";
export type { UsageSummary } from "../../../../../shared/remote-chat/usage";

export function useUsageStatus(active: boolean) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState("");
  const loading = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const refresh = async () => {
      if (loading.current || cancelled) return;
      loading.current = true;
      try {
        const nextUsage = decodeUsageSummary(await invoke<unknown>("codex_gui_usage_summary"));
        if (cancelled) return;
        setUsage(nextUsage);
        setError("");
      } catch {
        if (!cancelled) { setUsage(null); setError(uiText("client.errors.couldNotRefreshUsagePleaseTryAgainLater")); }
      } finally { loading.current = false; }
    };
    queueMicrotask(() => void refresh());
    const timer = setInterval(() => void refresh(), USAGE_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active]);

  return { usage, error };
}
