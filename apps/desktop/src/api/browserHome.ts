import { hasLocalBackend, isHostedWebApp, invoke } from '../../../../shared/platform/localBackend';
import type { BrowserHomeTransport, BrowserHomeView } from '../../../../shared/browser/useNavigationBrowserHome';

async function request(command: 'browser_home_cached' | 'browser_home_check') {
  const value = await invoke<BrowserHomeView | null>(command);
  if (!value || !isHostedWebApp) return value;
  return { ...value, url: new URL(new URL(value.url).pathname, window.location.origin).href };
}

export const nativeBrowserHomeTransport: BrowserHomeTransport | undefined = hasLocalBackend ? {
  readCached: () => request('browser_home_cached'),
  check: async (_base, signal) => {
    signal.throwIfAborted();
    const value = await request('browser_home_check');
    signal.throwIfAborted();
    return value;
  },
} : undefined;
