import { uiText } from "../../../../../shared/localization/uiText";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  patchCodexConfigDocument,
  readCodexConfigDocument,
  saveCodexConfigDocument,
  type CodexConfigDocument,
} from "../../api/codexConfig";
import { hasLocalBackend } from "../../api/backend";
import { ConfigWriteQueue } from "./configWriteQueue";
import type { ConfigValue } from "./schema";

type Operation = (current: CodexConfigDocument | null) => Promise<CodexConfigDocument>;

export function useCodexConfig(active: boolean, homeKey: string) {
  const [document, setDocument] = useState<CodexConfigDocument | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saved, setSaved] = useState(false);
  const queue = useRef(new ConfigWriteQueue());
  const mounted = useRef(true);
  const requestedHome = useRef<string>();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async (operation: Operation, isSave: boolean) => {
    setPending((count) => count + 1);
    try {
      const result = await queue.current.enqueue(operation);
      if (mounted.current) {
        setDocument(result);
        setError("");
        setSaved(isSave);
      }
      return true;
    } catch (failure) {
      if (mounted.current) {
        setError(failure instanceof Error ? failure.message : String(failure));
        setSaved(false);
      }
      return false;
    } finally {
      if (mounted.current) {
        setPending((count) => count - 1);
        setLoaded(true);
      }
    }
  }, []);

  const reload = useCallback(async () => {
    const success = await run(() => readCodexConfigDocument(homeKey), false);
    if (success && mounted.current) setReloadKey((key) => key + 1);
    return success;
  }, [homeKey, run]);

  useEffect(() => {
    if (!active || requestedHome.current === homeKey || !hasLocalBackend) return;
    requestedHome.current = homeKey;
    void reload();
  }, [active, homeKey, reload]);

  const commit = useCallback((path: string[], value: ConfigValue | null) => run(async (current) => {
    if (!current) throw new Error(uiText("client.configHelp.reloadTheConfigurationFirst"));
    return patchCodexConfigDocument({ path, value, expectedRevision: current.revision }, homeKey);
  }, true), [homeKey, run]);

  const saveContent = useCallback(async (content: string, expectedRevision: string): Promise<string | false> => {
    let savedRevision = expectedRevision;
    const success = await run(async (current) => {
      if (!current) throw new Error(uiText("client.configHelp.reloadTheConfigurationFirst"));
      if (current.revision !== expectedRevision) {
        throw new Error(uiText("client.configHelp.theConfigurationHasChangedYourEditsArePreservedReloadBefore"));
      }
      const result = current.content === content
        ? current : await saveCodexConfigDocument(content, expectedRevision, homeKey);
      savedRevision = result.revision;
      return result;
    }, true);
    return success ? savedRevision : false;
  }, [homeKey, run]);

  return { document, pending, error, loaded, reloadKey, saved, reload, commit, saveContent };
}
