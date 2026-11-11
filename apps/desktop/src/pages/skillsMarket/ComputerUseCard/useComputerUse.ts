import { useCallback, useEffect, useRef, useState } from "react";
import { computerUseAction, computerUseStatus, requestComputerUsePermission,
  type ComputerUseAction, type ComputerUsePermission, type ComputerUseStatus }
  from "../../../api/computerUse";

const REFRESH_INTERVAL_MS = 5000;

export function useComputerUse(homeId: string, active: boolean) {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [error, setError] = useState("");
  const [administratorError, setAdministratorError] = useState("");
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const pendingRefresh = useRef<(() => void) | null>(null);
  const changing = useRef(false);
  const revision = useRef(0);
  const actionError = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (loading.current || changing.current) return;
    loading.current = true;
    const started = revision.current;
    try {
      const result = await computerUseStatus(homeId);
      if (mounted.current && started === revision.current) {
        setStatus(result);
        if (!actionError.current) setError("");
      }
    } catch (caught) {
      if (mounted.current && started === revision.current && !actionError.current) setError(String(caught));
    } finally {
      loading.current = false;
      const pending = pendingRefresh.current;
      pendingRefresh.current = null;
      pending?.();
    }
  }, [homeId]);

  useEffect(() => {
    if (!active) return;
    if (loading.current) pendingRefresh.current = () => void refresh();
    else void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      pendingRefresh.current = null;
      revision.current += 1;
    };
  }, [active, refresh]);

  const perform = async (operation: () => Promise<ComputerUseStatus>, administrator = false) => {
    if (changing.current) return false;
    changing.current = true;
    revision.current += 1;
    actionError.current = false;
    setBusy(true);
    setError("");
    if (administrator) setAdministratorError("");
    try {
      const result = await operation();
      if (mounted.current) setStatus(result);
      return true;
    } catch (caught) {
      actionError.current = !administrator;
      if (mounted.current) {
        if (administrator) setAdministratorError(String(caught));
        else setError(String(caught));
      }
      return false;
    } finally {
      changing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const run = async (action: ComputerUseAction) => {
    const administrator = ["enableAdministrator", "grantAdministrator", "revokeAdministrator"].includes(action);
    const succeeded = await perform(() => computerUseAction(homeId, action), administrator);
    // A declined prompt updates the attempted state; refresh so the explicit retry stays available.
    if (!succeeded && action === "grantAdministrator") await refresh();
    return succeeded;
  };
  const requestPermission = (permission: ComputerUsePermission) => perform(async () => {
    await requestComputerUsePermission(permission);
    return computerUseStatus(homeId);
  });
  return { status, error, administratorError, busy, refresh, run, requestPermission };
}
