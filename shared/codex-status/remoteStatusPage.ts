import type { BrowserClient, BrowserCommand } from '../browser/automation';

/** A temporary host-side browser tab avoids third-party iframe restrictions in web clients. */
export function remoteStatusPage(client: BrowserClient, id: string, url: string) {
  const threadId = `codex-status-${id}`;
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();
  const opened = client.request({ threadId, command: { action: 'open', url, requestId: id } });
  const request = async (command: BrowserCommand) => {
    const reply = await opened;
    if (!reply.tab) throw new Error('market.browserFailed');
    return client.request({ threadId, tabId: reply.tab.id, command });
  };
  const command = (value: BrowserCommand) => {
    const next = tail.then(() => closed ? undefined : request(value));
    // Keep later commands usable after a navigation or screenshot failure.
    tail = next.catch(() => {});
    return next;
  };
  return {
    command,
    async read() {
      const snapshot = await command({ action: 'snapshot' });
      const screenshot = await command({ action: 'screenshot' });
      return { ...snapshot?.result, ...screenshot?.result };
    },
    close() {
      closed = true;
      return tail.then(() => request({ action: 'close' }));
    },
  };
}
