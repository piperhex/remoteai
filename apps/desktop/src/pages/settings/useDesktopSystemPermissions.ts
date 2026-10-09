import { useEffect, useRef, useState } from 'react';
import { invoke } from '../../api/backend';
import type { ComputerUsePermission, ComputerUsePermissions } from '../../api/computerUse';

const REFRESH_INTERVAL_MS = 3000;

export function useDesktopSystemPermissions(active: boolean) {
  const [permissions, setPermissions] = useState<ComputerUsePermissions | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const requesting = useRef(false);
  const generation = useRef(0);
  const revision = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    if (!active) return;
    const refresh = async () => {
      if (loading.current || requesting.current) return;
      loading.current = true;
      const started = revision.current;
      try {
        const result = await invoke<ComputerUsePermissions | null>('remote_desktop_system_permissions');
        if (current === generation.current && started === revision.current) setPermissions(result);
      } catch {
        // Older hosts and the headless settings page may not offer native system permissions.
      } finally { loading.current = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => { clearInterval(timer); generation.current += 1; };
  }, [active]);

  const request = async (permission: ComputerUsePermission) => {
    if (!active || requesting.current) return;
    requesting.current = true;
    revision.current += 1;
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const result = await invoke<ComputerUsePermissions | null>('remote_desktop_system_permissions',
        { request: permission });
      if (current === generation.current) setPermissions(result);
    } catch {
      if (current === generation.current) setError('未能打开权限设置，请在系统设置的“隐私与安全性”中开启。');
    } finally { requesting.current = false; setBusy(false); }
  };
  return { permissions, error, busy, request };
}
