import { useEffect, useRef, useState } from 'react';
import { invoke, restartApplication } from '../../api/backend';
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
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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

  const changePermission = async (permission: ComputerUsePermission, repair: boolean) => {
    if (!active || requesting.current) return;
    requesting.current = true;
    revision.current += 1;
    const current = generation.current;
    setBusy(true); setError('');
    try {
      if (repair) {
        const result = await invoke<{ settingsOpened: boolean }>('remote_desktop_repair_system_permission',
          { permission });
        if (current !== generation.current) return;
        setPermissions(previous => previous && ({ ...previous, [permission]: false,
          restartRequired: [...new Set([...(previous.restartRequired ?? []), permission])] }));
        if (!result.settingsOpened) setError('权限已重置，请手动打开系统设置，在“隐私与安全性”中重新开启。');
      } else {
        const result = await invoke<ComputerUsePermissions | null>('remote_desktop_system_permissions',
          { request: permission });
        if (current === generation.current) setPermissions(result);
      }
    } catch {
      if (current === generation.current) setError(repair
        ? '未能重置权限，请在系统设置的“隐私与安全性”中移除旧应用，再重新添加 Remote AI。'
        : '未能打开权限设置，请在系统设置的“隐私与安全性”中开启。');
    } finally {
      requesting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const restart = async () => {
    if (!active || requesting.current) return;
    requesting.current = true;
    const current = generation.current;
    setBusy(true); setError('');
    try { await restartApplication(); }
    catch {
      if (current === generation.current) setError('未能重启，请完全退出 Remote AI 后重新打开。');
    } finally {
      requesting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { permissions, error, busy, restart,
    request: (permission: ComputerUsePermission) => changePermission(permission, false),
    repair: (permission: ComputerUsePermission) => changePermission(permission, true) };
}
