import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { hasLocalBackend } from "../../api/backend";
import { readCodexConfigModelNames } from "../../api/codexConfig";
import { uiText } from "../../../../../shared/localization/uiText";

export const ConfigModelsContext = createContext<{ models: string[]; loading: boolean }>({
  models: [], loading: false,
});

export function useConfigModels(active: boolean) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const pending = useRef<Promise<void>>();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(() => {
    if (!mounted.current || !hasLocalBackend) return Promise.resolve();
    if (pending.current) return pending.current;
    setLoading(true);
    setError("");
    pending.current = readCodexConfigModelNames().then((names) => {
      if (mounted.current) setModels(names);
    }).catch(() => {
      if (mounted.current) setError(uiText("client.conversation.couldNotUpdateTheModelListPleaseTryAgainShortly"));
    }).finally(() => {
      pending.current = undefined;
      if (mounted.current) setLoading(false);
    });
    return pending.current;
  }, []);

  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  return { models, loading, error, reload };
}
