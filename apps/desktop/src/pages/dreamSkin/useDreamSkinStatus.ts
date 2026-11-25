import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import { loadDreamSkinResourcesStatus, loadDreamSkinStatus, subscribeToProviderEvents } from "../../api/backend";
import type { Translate } from "../../i18n";
import type { DreamSkinResourcesStatus, DreamSkinStatus } from "../../types";
import type { StatusState } from "./types";
import { isRestartRequired } from "./constants";
import { publishDreamSkinStatus } from "./statusEvents";

export function useDreamSkinStatus(t: Translate, notify: (message: string) => void): StatusState {
  const [status, setStatus] = useState<DreamSkinStatus | null>(null);
  const [resources, setResources] = useState<DreamSkinResourcesStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    try {
      setStatus(await loadDreamSkinStatus());
      setError(null);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => subscribeToProviderEvents(refresh), [refresh]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      void loadDreamSkinResourcesStatus()
        .then((next) => { if (!cancelled) setResources(next); })
        .catch((resourceError) => {
          if (cancelled) return;
          setResources((current) => ({
            phase: "error",
            installed: current?.installed ?? false,
            installedVersion: current?.installedVersion,
            availableVersion: current?.availableVersion,
            downloadedBytes: current?.downloadedBytes ?? 0,
            totalBytes: current?.totalBytes,
            error: String(resourceError),
          }));
        }).finally(() => { inFlight = false; });
    };
    poll();
    const timer = window.setInterval(poll, 750);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const runStatusOperation = useCallback(async (
    key: string,
    operation: () => Promise<DreamSkinStatus>,
    successMessage: string,
  ) => {
    setBusy(key);
    setError(null);
    try {
      const next = await operation();
      setStatus(next);
      publishDreamSkinStatus(next);
      notify(successMessage);
      return true;
    } catch (operationError) {
      if (isRestartRequired(operationError)) throw operationError;
      setError(String(operationError));
      return false;
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const confirmChatGptRestart = useCallback((operation: () => Promise<unknown>) => {
    Modal.confirm({
      title: t("dreamSkin.restart.confirmTitle"),
      content: t("dreamSkin.restart.confirmDescription"),
      okText: t("dreamSkin.restart.confirmAction"),
      cancelText: t("table.cancel"),
      onOk: operation,
    });
  }, [t]);

  return {
    busy, error, loading, resources, status, confirmChatGptRestart, refresh, runStatusOperation,
    setBusy, setError, setResources,
  };
}
