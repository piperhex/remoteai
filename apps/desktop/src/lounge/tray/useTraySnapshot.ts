import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { applyThemeMode, loadThemeMode } from '../../utils/themeMode';
import type { TraySnapshot } from '../trayMessages';

export function useTraySnapshot() {
  const [snapshot, setSnapshot] = useState<TraySnapshot>();
  useEffect(() => {
    let disposed = false;
    let loading = false;
    let pending = false;
    const load = async () => {
      pending = true;
      if (loading || disposed) return;
      loading = true;
      try {
        while (pending && !disposed) {
          pending = false;
          const next = await invoke<TraySnapshot>('lounge_tray_snapshot');
          if (!disposed) {
            applyThemeMode(loadThemeMode());
            setSnapshot(next);
          }
        }
      } catch (error) {
        console.error('Could not open the lounge tray', error);
      } finally { loading = false; }
    };
    const subscription = listen('lounge-tray-refresh', () => { void load(); });
    void subscription.then(load).catch(console.error);
    const updateAppearance = () => { void load(); };
    window.addEventListener('storage', updateAppearance);
    return () => {
      disposed = true;
      window.removeEventListener('storage', updateAppearance);
      void subscription.then(unlisten => unlisten()).catch(console.error);
    };
  }, []);
  return snapshot;
}
