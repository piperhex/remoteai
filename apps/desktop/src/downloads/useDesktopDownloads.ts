import { useEffect } from 'react';
import { downloadManager } from '../../../web/src/downloads/manager';
import type { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { GuiCloudIdentity, GuiComputer } from '../pages/codexGui/remote/types';

export const desktopDownloadOwner = (identity: GuiCloudIdentity) =>
  JSON.stringify(['desktop', identity.baseUrl, identity.userId]);

/** Keep transfers attached to their remote connection, independently of the visible page. */
export function useDesktopDownloads(options: {
  identity: GuiCloudIdentity; device: GuiComputer;
  controller: Pick<ChatController, 'snapshot' | 'subscribe' | 'downloads' | 'files'>;
}) {
  const { identity, device, controller } = options;
  useEffect(() => {
    void downloadManager.initialize();
    const update = () => {
      const state = controller.snapshot();
      downloadManager.register({ owner: desktopDownloadOwner(identity), deviceId: device.deviceId,
        deviceName: device.name, ready: state.ready, mode: state.mode,
        threadId: state.selected?.id, cwd: state.selected?.cwd ?? state.draftProject?.cwd,
        client: controller.downloads, files: controller.files });
    };
    update();
    const unsubscribe = controller.subscribe(update);
    return () => { unsubscribe(); downloadManager.unbind(controller.files); };
  }, [identity.baseUrl, identity.userId, device.deviceId, device.name, controller]);
}
