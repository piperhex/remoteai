import { SshWorkspace } from '../../../../../shared/terminal/workspace/SshWorkspace';
import type { TerminalApi } from '../../../../../shared/terminal/types';
import { uiText as t } from '../../../../../shared/localization/uiText';
import type { GuiComputerNavigation, GuiCloudIdentity } from '../../../../../shared/conversation/remote/types';
import { terminalApi } from '../codexGui/terminal/api';
import { attachSsh } from '../codexGui/terminal/sshApi';
import { useLocalGitDownloads } from '../../downloads/localGitDownloads';

export interface RemoteSshHost { scope: string; api: TerminalApi; ready: boolean }
const localApi: TerminalApi = {
  ...terminalApi,
  attach: (info, _size, listener) => attachSsh(info, listener, false),
};

export default function DesktopSshPage({ active, computers, identity, remote }: {
  active: boolean; computers: GuiComputerNavigation; identity: GuiCloudIdentity | null; remote: RemoteSshHost | null;
}) {
  useLocalGitDownloads();
  const device = computers.current;
  const owner = JSON.stringify([identity?.baseUrl, identity?.userId]);
  const scope = JSON.stringify([identity?.baseUrl, identity?.userId, device?.deviceId]);
  const binding = remote?.scope === scope ? remote : undefined;
  return <SshWorkspace key={scope + (binding ? '/remote' : '')} active={active} scope={owner}
    api={binding?.api ?? localApi} available={!!identity && (!device || !!binding?.ready)}
    host={device ? t('client.discovery.sshViaComputer', { name: device.name }) : t('client.composer.thisComputer')}
    login={identity ? undefined : computers.login} />;
}
