import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { idleDownload } from '../../../../shared/app-update/idleDownload';
import { canAutoDownload } from './androidSharedDownload';
import { checkForAppUpdate, refreshAndroidUpdateDownloadState, startAndroidUpdateDownload } from './appUpdate';
import { startupUpdateOptions } from './startupUpdate';

const RECHECK_MS = 6 * 60 * 60_000;
const RETRY_MS = 15 * 60_000;

/** Only prepare an APK after an idle minute on Wi-Fi; installation always needs the user's action. */
export function useIdleAppUpdate() {
  const scheduler = useRef<ReturnType<typeof idleDownload> | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let nextCheck = 0;
    const current = idleDownload({
      eligible: async () => AppState.currentState === 'active' && Date.now() >= nextCheck && await canAutoDownload(),
      run: async active => {
        nextCheck = Date.now() + RETRY_MS;
        const state = await refreshAndroidUpdateDownloadState();
        if (!active() || state.status === 'downloading' || state.status === 'downloaded') return;
        const result = await checkForAppUpdate();
        const ignored = await startupUpdateOptions.readIgnoredVersion();
        const wifi = await canAutoDownload();
        if (!wifi || !active() || AppState.currentState !== 'active') return;
        if (result.updateAvailable && result.release.androidAsset && result.release.version !== ignored) {
          await startAndroidUpdateDownload(result.release, { wifiOnly: true });
        }
        nextCheck = Date.now() + RECHECK_MS;
      },
    });
    scheduler.current = current;
    const listener = AppState.addEventListener('change', () => current.touch());
    return () => { current.dispose(); listener.remove(); scheduler.current = null; };
  }, []);
  return () => scheduler.current?.touch();
}
