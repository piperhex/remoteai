import { SshWorkspace } from '../../../../../shared/terminal/workspace/SshWorkspace';
import { nativeSshDrop } from '../../../../../shared/terminal/views/sshDrop';
import type { useSshHosts } from '../../../../../shared/terminal/workspace/useSshHosts';
import type { TerminalApi } from '../../../../../shared/terminal/types';
import { uiText as t } from '../../../../../shared/localization/uiText';
import type { GuiComputerNavigation, GuiCloudIdentity } from '../../../../../shared/conversation/remote/types';
import { terminalApi } from '../codexGui/terminal/api';
import { attachSsh } from '../codexGui/terminal/sshApi';
import { useLocalGitDownloads } from '../../downloads/localGitDownloads';

const LOCAL_DEVICE = 'local';
const localApi: TerminalApi = {
  ...terminalApi,
  attach: (info, _size, listener) => attachSsh(info, listener, false),
};

export default function DesktopSshPage({ active, computers, identity, hosts }: {
  active: boolean; computers: GuiComputerNavigation & { localName?: string }; identity: GuiCloudIdentity | null;
  hosts: Pick<ReturnType<typeof useSshHosts>, 'get' | 'request'>;
}) {
  useLocalGitDownloads();
  const scope = JSON.stringify([identity?.baseUrl, identity?.userId]);
  const localName = computers.localName || t('client.composer.thisComputer');
  const local = { deviceId: LOCAL_DEVICE, name: localName, api: localApi, ready: !!identity };
  const device = computers.current;
  const defaultHost = device ? hosts.get(device.deviceId) ?? { ...local, ready: false } : local;
  return <SshWorkspace key={scope} active={active} scope={scope} defaultHost={defaultHost} nativeDrop={nativeSshDrop}
    directory={{ localDeviceId: LOCAL_DEVICE, devices: [
      { deviceId: LOCAL_DEVICE, name: localName, platform: '', ...computers.localSystem, online: true }, ...computers.devices],
      get: id => id === LOCAL_DEVICE ? local : hosts.get(id),
      request: id => { if (id !== LOCAL_DEVICE) hosts.request(id); }, refresh: computers }}
    login={identity ? undefined : computers.login} />;
}
