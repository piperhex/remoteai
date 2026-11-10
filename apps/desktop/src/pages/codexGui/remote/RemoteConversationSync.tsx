import { ConversationSyncPanel } from '../../../../../../shared/conversation/sync/ConversationSyncPanel';
import { useDesktopSyncHosts } from '../syncHosts';
import type { GuiCloudIdentity, GuiComputer } from '../../../../../../shared/conversation/remote/types';

interface Props {
  identity: GuiCloudIdentity; devices: GuiComputer[]; device: GuiComputer; onSynced: () => void; active: boolean;
}

export function RemoteConversationSync(props: Props) {
  return props.active ? <RemoteSyncContent {...props} /> : null;
}

function RemoteSyncContent({ identity, devices, device, onSynced }: Props) {
  const hosts = useDesktopSyncHosts({ identity, devices });
  const destination = hosts.find(host => host.id === device.deviceId);
  if (!destination) return null;
  return <ConversationSyncPanel hosts={hosts} destination={destination} onSynced={onSynced} />;
}
