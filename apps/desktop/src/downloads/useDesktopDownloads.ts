import { useEffect } from 'react';
import { downloadManager } from '../../../../shared/downloads/manager';
import type { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { GuiCloudIdentity, GuiComputer } from '../../../../shared/conversation/remote/types';
import type { CloudAuthState } from '../types';

export const desktopDownloadOwner = (identity: GuiCloudIdentity) =>
  JSON.stringify(['desktop', identity.baseUrl, identity.userId]);

export const authenticatedDownloadOwner = (auth: CloudAuthState) =>
  auth.authenticated && auth.baseUrl && auth.userId
    ? desktopDownloadOwner({ baseUrl: auth.baseUrl, userId: auth.userId }) : '';

/** Keep transfers attached to their remote connection, independently of the visible page. */
export function useDesktopDownloads(options: {
  identity: GuiCloudIdentity; device: GuiComputer;
  controller: Pick<ChatController, 'snapshot' | 'subscribe' | 'downloads' | 'files' | 'guiTools'>;
}) {
  const { identity, device, controller } = options;
  useEffect(() => {
    void downloadManager.initialize();
    const update = () => {
      const state = controller.snapshot();
      downloadManager.register({ owner: desktopDownloadOwner(identity), deviceId: device.deviceId,
        deviceName: device.name, ready: state.ready, mode: state.mode,
        threadId: state.selected?.id, cwd: state.selected?.cwd ?? state.draftProject?.cwd,
        client: controller.downloads, files: controller.files, git: controller.guiTools.git,
        projectBrowser: controller.guiTools.projectBrowser, ssh: controller.guiTools.terminal.ssh });
    };
    update();
    const unsubscribe = controller.subscribe(update);
    return () => { unsubscribe(); downloadManager.unbind(controller.files); };
  }, [identity.baseUrl, identity.userId, device.deviceId, device.name, controller]);
}
