import { useEffect } from 'react';
import { downloadManager } from '../../../../shared/downloads/manager';
import type { DownloadConnection } from '../../../../shared/downloads/types';
import { guiApi } from '../../../../shared/conversation/api';
import { localGitClient } from '../pages/codexGui/localGitClient';
import { fileDownloadByteLimit } from '../../../../shared/remote-chat/policy';
import { uiText } from "../../../../shared/localization/uiText";
import { sshApi } from '../pages/codexGui/terminal/sshApi';

export const LOCAL_DOWNLOAD_OWNER = 'desktop-local';
const client: DownloadConnection['client'] = {
  open: options => guiApi.request({ ...options, operation: 'downloadOpen', maxBytes: fileDownloadByteLimit('direct') }),
  browse: options => guiApi.request({ ...options, operation: 'downloadBrowse' }),
  read: options => guiApi.request({ ...options, operation: 'fileRead', maxBytes: fileDownloadByteLimit('direct') }),
  close: (threadId, id) => guiApi.request({ operation: 'fileClose', threadId, id }),
};
const files: DownloadConnection['files'] = {
  open: async () => { throw new Error('请选择一个 Git 提交后创建补丁。'); },
  read: client.read, close: client.close,
};

/** Keep local jobs available across page changes and application restarts, including while signed out. */
export function useLocalGitDownloads() {
  useEffect(() => {
    if (downloadManager.connectionForGit(localGitClient)) return;
    downloadManager.register({ owner: LOCAL_DOWNLOAD_OWNER, deviceId: 'local', deviceName: uiText("client.composer.thisComputer"),
      ready: true, mode: 'direct', client, files, git: localGitClient, ssh: sshApi });
  }, []);
}
