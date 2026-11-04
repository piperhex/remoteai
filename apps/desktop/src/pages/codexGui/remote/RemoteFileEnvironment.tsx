import { useEffect, useMemo, type ReactNode } from 'react';
import { message } from 'antd';
import type { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import { downloadManager } from '../../../../../../shared/downloads/manager';
import { ChatImage } from '../../../../../../shared/remote-chat/views/ChatImage';
import { FileEnvironmentContext, type FileEnvironment } from '../../../../../../shared/conversation/fileEnvironment';
import { FileThreadContext } from '../../../../../../shared/conversation/fileApi';
import { uiText } from "../../../../../../shared/localization/uiText";
import { RemoteFileAccess } from './fileAccess';
import { isDesktopApp } from '../../../api/backend';

export function RemoteFileEnvironment({ controller, ready, threadId, children }: {
  controller: ChatController; ready: boolean; threadId: string | null; children: ReactNode;
}) {
  const scope = useMemo(() => {
    // Lazily instantiate so React StrictMode's cleanup/setup cycle cannot reuse a disposed transport.
    let access: RemoteFileAccess | undefined;
    const requireReady = () => {
      if (!controller.snapshot().ready) throw new Error('请连接远程电脑后重试。');
    };
    const current = () => { requireReady(); return access ??= new RemoteFileAccess(controller.guiTools.files); };
    const environment: FileEnvironment = {
      remote: true,
      previews: { open: target => current().open(target), close: id => access?.close(id) ?? Promise.resolve() },
      resolveWebsite: url => current().resolveWebsite(url),
      image: props => <ChatImage source={props.src} description={props.alt} compact={props.compact} />,
      actions: {
        applications: async () => { requireReady(); return controller.guiTools.files.applications(); },
        perform: async (target, action) => {
          requireReady();
          if (action.type !== 'saveAs') return controller.guiTools.files.perform(target, action);
          const connection = downloadManager.connectionForFile(controller.files);
          if (!connection || !target.threadId) throw new Error('请连接远程电脑后重试。');
          await downloadManager.enqueue({ owner: connection.owner, deviceId: connection.deviceId,
            deviceName: connection.deviceName, scope: 'project', threadId: target.threadId, path: target.path });
          void message.success({ content: uiText("client.downloads.addedToDownloads"),
            style: { maxWidth: 400, marginInline: 'auto' } });
          return { path: target.path, saved: false };
        },
      },
    };
    return { environment, dispose: () => { access?.dispose(); access = undefined; } };
  }, [controller, ready]);
  useEffect(() => scope.dispose, [scope]);
  return <FileEnvironmentContext.Provider value={isDesktopApp ? scope.environment : null}>
    <FileThreadContext.Provider value={threadId}>{children}</FileThreadContext.Provider>
  </FileEnvironmentContext.Provider>;
}
