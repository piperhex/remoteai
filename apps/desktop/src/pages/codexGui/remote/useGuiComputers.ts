import { uiText } from "../../../../../../shared/localization/uiText";
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isDesktopApp } from '../../../api/backend';
import type { GuiCloudIdentity, GuiComputer, GuiComputerNavigation, GuiDeviceDirectory } from '../../../../../../shared/conversation/remote/types';

const DEVICE_REFRESH_MS = 15_000;
const scopeOf = (identity: GuiCloudIdentity | null) => identity ? `${identity.baseUrl}\n${identity.userId}` : '';

interface ComputerDirectory extends GuiComputerNavigation {
  identity: GuiCloudIdentity | null;
  localName?: string;
}

export function useGuiComputers(options: {
  active: boolean; identity: GuiCloudIdentity | null; login: () => void;
}): ComputerDirectory {
  const [directory, setDirectory] = useState<GuiDeviceDirectory | null>(null);
  const [selected, setSelected] = useState<{ scope: string; device: GuiComputer } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useRef(() => {});
  const scope = scopeOf(options.identity);

  useEffect(() => { setDirectory(null); setError(''); setLoading(false); }, [scope]);
  useEffect(() => {
    if (!isDesktopApp || !options.active) return;
    let cancelled = false;
    let pending = false;
    const read = async () => {
      if (pending || cancelled) return;
      pending = true; setLoading(true);
      try {
        const result = await invoke<GuiDeviceDirectory>('codex_gui_devices');
        if (!cancelled && scopeOf(result.identity) === scope) { setDirectory(result); setError(''); }
        else if (!cancelled) { setDirectory(null); setError(uiText("client.workspaceActions.signInAgainToViewOtherComputers")); }
      } catch { if (!cancelled) setError(uiText("client.workspaceActions.couldNotLoadTheComputerListPleaseTryAgain")); }
      finally { pending = false; if (!cancelled) setLoading(false); }
    };
    refresh.current = () => { void read(); };
    void read();
    const timer = scope ? setInterval(() => { void read(); }, DEVICE_REFRESH_MS) : undefined;
    return () => { cancelled = true; clearInterval(timer); refresh.current = () => {}; };
  }, [scope, options.active]);

  const current = selected?.scope === scope ? selected.device : null;
  const choose = useCallback((device: GuiComputer | null) => {
    if (!device) { setSelected(null); return; }
    if (!scope || !device.online || !directory?.devices.some((entry) => entry.deviceId === device.deviceId)) return;
    setSelected({ scope, device });
  }, [scope, directory]);
  return {
    localSystem: directory?.currentDevicePlatform ? {
      platform: directory.currentDevicePlatform, ipAddress: directory.currentDeviceIpAddress,
    } : undefined,
    localName: scopeOf(directory?.identity ?? null) === scope ? directory?.currentDeviceName ?? undefined : undefined,
    current, identity: options.identity, devices: scopeOf(directory?.identity ?? null) === scope
      ? directory?.devices ?? [] : [], authenticated: Boolean(scope),
    loading, error, choose, refresh: () => refresh.current(), login: options.login,
  };
}
