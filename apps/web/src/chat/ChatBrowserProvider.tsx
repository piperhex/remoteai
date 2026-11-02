import { useMemo, type ReactNode } from 'react';
import type { ChatController } from '../../../../shared/remote-chat/client/controller';
import { browserEvent, type BrowserClient } from '../../../../shared/browser/automation';
import { BrowserClientContext } from '../../../desktop/src/pages/codexGui/filePreview/browserClient';

export function ChatBrowserProvider({ controller, children }: { controller: ChatController; children: ReactNode }) {
  const client = useMemo<BrowserClient>(() => ({ native: false,
    request: request => controller.guiTools.browser(request),
    subscribe: async callback => controller.subscribeEvents(event => {
      const browser = browserEvent(event); if (browser) callback(browser);
    }),
  }), [controller]);
  return <BrowserClientContext.Provider value={client}>{children}</BrowserClientContext.Provider>;
}
