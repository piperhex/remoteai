import { desktopChatConnection } from './desktopChatConnection';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import { createBrowserHistoryVersions } from '../../../../../../shared/remote-chat/browserHistory';
import { useActiveChatPolicy } from '../../../../../../shared/remote-chat/useActiveChatPolicy';
import { createDesktopSshProfiles } from '../../../api/sshProfiles';
import type { GuiCloudIdentity } from '../../../../../../shared/conversation/remote/types';
import { browserDirectoryStorage } from '../../../../../../shared/chat/directory/storage';

const HISTORY_REFRESH_MS = 15_000;

export function useRemoteGui(identity: GuiCloudIdentity, deviceId: string, active: boolean) {
  const controller = useMemo(() => {
    const value = new ChatController(events => desktopChatConnection(identity, deviceId, events),
      undefined, createBrowserHistoryVersions(), createDesktopSshProfiles(identity));
    value.directoryStorage = browserDirectoryStorage(JSON.stringify([identity.baseUrl, identity.userId]), deviceId);
    return value;
  }, [identity.baseUrl, identity.userId, deviceId]);
  controller.deferToolDetails = true;
  controller.pagedTurnReviews = true;
  controller.deferProcessDetails = true;
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useActiveChatPolicy(active, state.mode);
  useEffect(() => { controller.setHistoryActive(active); }, [controller, active]);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  useEffect(() => {
    if (!active || !state.ready) return;
    const refresh = () => { void controller.refreshSelected(); };
    refresh();
    const timer = setInterval(refresh, HISTORY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, state.ready, controller]);
  return { controller, state, foreground: true };
}
