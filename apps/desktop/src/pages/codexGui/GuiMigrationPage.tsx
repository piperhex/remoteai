import { ConversationSyncPanel } from '../../../../../shared/conversation/sync/ConversationSyncPanel';
import { useDesktopSyncHosts, type SyncComputerDirectory } from './syncHosts';
import { getGuiController } from "./session";

export default function GuiMigrationPage({ computers, active }: {
  active: boolean;
  notify: (message: string) => void;
  computers?: SyncComputerDirectory;
}) {
  return active ? <ActiveSync computers={computers} /> : null;
}

function ActiveSync({ computers }: { computers?: SyncComputerDirectory }) {
  const hosts = useDesktopSyncHosts(computers);
  return <ConversationSyncPanel hosts={hosts} destination={hosts[0]}
    onSynced={() => { void getGuiController().refresh(); }} />;
}
