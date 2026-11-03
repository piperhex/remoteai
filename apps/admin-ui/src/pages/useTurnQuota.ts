import { useCallback, useEffect, useRef, useState } from 'react';

export interface TurnQuotaStatus {
  totalQuota: number;
  appliedQuota: number | null;
  state: 'applied' | 'pending';
  issue?: 'not_configured' | 'control_unavailable' | 'restart_snapshot_failed';
  checkedAt: string;
}
export interface TurnQuotaProps {
  api: <T>(path: string, options?: RequestInit) => Promise<T>;
  canManage: boolean;
}
const path = '/admin/api/chat-settings/turn-relay';
const pollInterval = 3000;

export function useTurnQuota(api: TurnQuotaProps['api']) {
  const [status, setStatus] = useState<TurnQuotaStatus>();
  const [error, setError] = useState<'loadFailed' | 'saveFailed' | 'retryFailed'>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const flight = useRef<Promise<void>>();
  const mutating = useRef(false);
  const load = useCallback(async () => {
    if (mutating.current) return;
    if (flight.current) return flight.current;
    const request = async () => {
      try {
        const result = await api<TurnQuotaStatus>(path);
        if (mounted.current) { setStatus(result); setError(undefined); }
      } catch { if (mounted.current) setError('loadFailed'); }
      finally { flight.current = undefined; }
    };
    flight.current = request();
    return flight.current;
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = window.setInterval(() => { void load(); }, pollInterval);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [load]);
  const mutate = async (value?: number) => {
    if (mutating.current) return false;
    mutating.current = true;
    setBusy(true);
    // A save clicked during status polling must wait, never silently disappear.
    await flight.current;
    try {
      const result = await api<TurnQuotaStatus>(value === undefined ? `${path}/retry` : path, {
        method: value === undefined ? 'POST' : 'PATCH',
        ...(value === undefined ? {} : { body: JSON.stringify({ totalQuota: value }) }),
      });
      if (mounted.current) { setStatus(result); setError(undefined); }
      return true;
    } catch { if (mounted.current) setError(value === undefined ? 'retryFailed' : 'saveFailed'); return false; }
    finally { mutating.current = false; if (mounted.current) setBusy(false); }
  };
  return { status, error, busy, load, save: (value: number) => mutate(value), retry: () => mutate() };
}
