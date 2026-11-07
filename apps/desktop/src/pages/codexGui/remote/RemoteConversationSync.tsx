import { ConversationSyncDialog, SyncDialogPanel }
  from '../../../../../../shared/conversation/sync/ConversationSyncDialog';
import { useDesktopSyncHosts } from '../syncHosts';
import type { GuiCloudIdentity, GuiComputer } from '../../../../../../shared/conversation/remote/types';

interface Props {
  identity: GuiCloudIdentity; devices: GuiComputer[]; device: GuiComputer; onSynced: () => void; active: boolean;
}

export function RemoteConversationSync(props: Props) {
  return <ConversationSyncDialog active={props.active}><RemoteSyncContent {...props} /></ConversationSyncDialog>;
}

function RemoteSyncContent({ identity, devices, device, onSynced }: Props) {
  const hosts = useDesktopSyncHosts({ identity, devices });
  const destination = hosts.find(host => host.id === device.deviceId);
  if (!destination) return null;
  return <SyncDialogPanel hosts={hosts} destination={destination} onSynced={onSynced} />;
}
