import { useEffect } from 'react';
import { idleDownload } from '../../../../shared/app-update/idleDownload';

interface ConnectionHint extends EventTarget { type?: string; saveData?: boolean }

function wifiAvailable() {
  const connection = (navigator as Navigator & { connection?: ConnectionHint }).connection;
  return connection?.type === 'wifi' && connection.saveData !== true;
}

/** Browsers cannot install APKs or use the native peer transport; warm this site's assets on Wi-Fi. */
export function useIdleWebUpdate(version: string | undefined) {
  useEffect(() => {
    if (!version) return;
    let prepared = false;
    let controller: AbortController | undefined;
    const scheduler = idleDownload({
      eligible: async () => {
        return !prepared && document.visibilityState === 'visible'
          && wifiAvailable();
      },
      run: async active => {
        controller = new AbortController();
        await prepareWebUpdate({ active: () => active() && wifiAvailable(), signal: controller.signal });
        prepared = true;
      },
    });
    const events = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'] as const;
    events.forEach(event => window.addEventListener(event, scheduler.touch, { passive: true }));
    const connection = (navigator as Navigator & { connection?: ConnectionHint }).connection;
    const networkChanged = () => { if (!wifiAvailable()) controller?.abort(); };
    connection?.addEventListener?.('change', networkChanged);
    return () => {
      scheduler.dispose(); controller?.abort();
      connection?.removeEventListener?.('change', networkChanged);
      events.forEach(event => window.removeEventListener(event, scheduler.touch));
    };
  }, [version]);
}

export async function prepareWebUpdate(options: { active(): boolean; signal: AbortSignal }) {
  const response = await fetch(import.meta.env.BASE_URL, { cache: 'no-store', signal: options.signal });
  if (!response.ok) throw new Error('Update unavailable');
  const document = new DOMParser().parseFromString(await response.text(), 'text/html');
  const urls = [...document.querySelectorAll('script[type="module"][src], link[rel="stylesheet"], link[rel="modulepreload"]')]
    .map(element => new URL(element.getAttribute('src') ?? element.getAttribute('href') ?? '', response.url))
    .filter(url => url.origin === window.location.origin && /\.(?:js|css)$/.test(url.pathname));
  for (const url of [...new Set(urls.map(url => url.href))].slice(0, 20)) {
    if (!options.active()) throw new Error('Update preparation postponed');
    const asset = await fetch(url, { cache: 'force-cache', signal: options.signal });
    if (!asset.ok) throw new Error('Update unavailable');
    // Consume the response so the HTTP cache is ready when the user chooses to reload.
    await asset.arrayBuffer();
  }
}
