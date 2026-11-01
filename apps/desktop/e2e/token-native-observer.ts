import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readTokenQuery } from '../../../shared/token-usage/queryCache';

const stateQueries = { visible: 0, minimized: 0, inFlight: 0, maxInFlight: 0, delayMs: 0 };
if ('__TAURI_INTERNALS__' in window) Object.assign(window, {
  nativeLabel: getCurrentWindow().label,
  nativeQuery: (key: string) => readTokenQuery({ key, maxAgeMs: 60_000, load: () => invoke('probe_shared_read') }),
  nativeControl: (label: string, action: string) => invoke('probe_control', { label, action }),
  nativeCounts: () => invoke('probe_counts'),
  nativeState: async () => ({ visible: await getCurrentWindow().isVisible(),
    minimized: await getCurrentWindow().isMinimized(), focused: await getCurrentWindow().isFocused() }),
  __windowMetrics: stateQueries,
  __windowProbe: async (name: 'visible' | 'minimized', load: () => Promise<boolean>) => {
    stateQueries[name]++;
    stateQueries.inFlight++;
    stateQueries.maxInFlight = Math.max(stateQueries.maxInFlight, stateQueries.inFlight);
    try {
      const result = load();
      if (stateQueries.delayMs) await new Promise(resolve => setTimeout(resolve, stateQueries.delayMs));
      return await result;
    } finally { stateQueries.inFlight--; }
  },
});
