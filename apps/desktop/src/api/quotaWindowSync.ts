import { loadAppSettings, hasLocalBackend, invoke } from './backend';

const PREVIEW_KEY = 'codex-switch:quota-window-sync';

export const quotaWindowSyncApi = {
  load: async (): Promise<boolean> => hasLocalBackend
    ? (await loadAppSettings()).quotaWindowSyncEnabled ?? false
    : localStorage.getItem(PREVIEW_KEY) === 'true',
  save: async (enabled: boolean): Promise<boolean> => {
    if (!hasLocalBackend) {
      localStorage.setItem(PREVIEW_KEY, String(enabled));
      return enabled;
    }
    const settings = await invoke<{ quotaWindowSyncEnabled: boolean }>(
      'set_quota_window_sync_enabled', { enabled },
    );
    return settings.quotaWindowSyncEnabled;
  },
};
