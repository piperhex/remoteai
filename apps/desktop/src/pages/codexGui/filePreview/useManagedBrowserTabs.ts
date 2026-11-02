import { useContext, useEffect, useRef } from 'react';
import type { ManagedBrowserTab } from '../../../../../../shared/browser/automation';
import { BrowserClientContext } from './browserClient';

export function useManagedBrowserTabs(options: {
  threadId: string | null; active: boolean; open: (tab: ManagedBrowserTab) => void; close: (id: string) => void;
}) {
  const client = useContext(BrowserClientContext);
  const latest = useRef(options); latest.current = options;
  useEffect(() => {
    if (!options.threadId || !options.active) return;
    let disposed = false;
    const closed = new Set<string>();
    const open = (tab: ManagedBrowserTab) => {
      if (!disposed && !closed.has(tab.id) && tab.threadId === options.threadId) latest.current.open(tab);
    };
    const listener = client.subscribe(event => {
      if (event.type === 'opened') open(event.tab);
      else if (!disposed && event.threadId === options.threadId) {
        closed.add(event.tabId); latest.current.close(event.tabId);
      }
    });
    void listener.catch(error => console.debug('Browser preview subscription unavailable', error));
    void client.request({ threadId: options.threadId, command: { action: 'list' } })
      .then(reply => reply.tabs?.forEach(open))
      // Older remote hosts do not provide this optional capability. Manual previews remain available.
      .catch(error => console.debug('Browser preview discovery unavailable', error));
    return () => { disposed = true; void listener.then(stop => stop()).catch(() => {}); };
  }, [client, options.threadId, options.active]);
}
