import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { ChatController } from '../chat/controller';
import type { AuthSession } from '../types';
import { downloadManager, downloadOwner } from './manager';
import { getChatPolicy, subscribeChatPolicy } from '../../../../shared/remote-chat/policy';

export function useDownloadConnection(options: {
  session: AuthSession; deviceId: string; deviceName: string; controller: ChatController;
}) {
  const { session, deviceId, deviceName, controller } = options;
  useEffect(() => {
    if (Platform.OS !== 'android' || !deviceId) return;
    const update = () => {
      const state = controller.snapshot();
      downloadManager.bind({ owner: downloadOwner(session), deviceId, deviceName,
        ready: state.ready, mode: state.mode, windowSize: getChatPolicy().fileDownloadWindowSize,
        threadId: state.selected?.id, cwd: state.selected?.cwd ?? state.draftProject?.cwd,
        client: controller.downloads, files: controller.files });
    };
    update();
    const unsubscribe = controller.subscribe(update);
    const unsubscribePolicy = subscribeChatPolicy(update);
    return () => { unsubscribe(); unsubscribePolicy(); downloadManager.unbind(controller.files); };
  }, [session, deviceId, deviceName, controller]);
}
