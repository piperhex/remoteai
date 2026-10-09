import { useCallback, useEffect, useRef, useState } from "react";
import { gitApi, type GitRequest, type GitStatus, type GitWorkspaceClient } from "./gitApi";

export function useGitWorkspace({ cwd, onChange, onBusyChange, request = gitApi.request, enabled = true }: {
  cwd: string; onChange: (cwd: string) => void; onBusyChange: (busy: boolean) => void;
  request?: GitWorkspaceClient; enabled?: boolean;
}) {
  const [status, setStatus] = useState<GitStatus>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const flight = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (flight.current || !cwd || !enabled) return;
    flight.current = true; setLoading(true);
    try {
      const result = await request({ operation: "status", cwd });
      if (mounted.current) { setStatus(result); setError(""); }
    } catch (error) {
      if (mounted.current) { setStatus(undefined); setError(error instanceof Error ? error.message : String(error)); }
    } finally { flight.current = false; if (mounted.current) setLoading(false); }
  }, [cwd, request, enabled]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);
  const run = async (input: GitRequest) => {
    if (flight.current || !mounted.current || !enabled) return false;
    flight.current = true; setBusy(true); setError(""); onBusyChange(true);
    try {
      const result = await request(input);
      if (!mounted.current) return false;
      setStatus(result);
      if (input.operation === "createWorktree") onChange(result.cwd);
      return true;
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error));
      return false;
    }
    finally {
      flight.current = false; onBusyChange(false);
      if (mounted.current) setBusy(false);
    }
  };
  return { status, loading, busy, error, refresh, run };
}
