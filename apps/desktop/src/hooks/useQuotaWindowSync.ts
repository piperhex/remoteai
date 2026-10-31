import { useCallback, useEffect, useRef, useState } from 'react';
import { quotaWindowSyncApi } from '../api/quotaWindowSync';

export function useQuotaWindowSync() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'loadError' | 'saveError' | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const value = await quotaWindowSyncApi.load();
      if (mounted.current) { setEnabled(value); setError(null); }
    } catch {
      if (mounted.current) setError('loadError');
    } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  const update = useCallback(async (value: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const saved = await quotaWindowSyncApi.save(value);
      if (mounted.current) { setEnabled(saved); setError(null); }
    } catch {
      if (mounted.current) setError('saveError');
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }, []);

  return { enabled, saving, error, refresh, update };
}
