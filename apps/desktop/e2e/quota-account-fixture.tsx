import { DEMO_ACCOUNTS } from '../src/demo';
import { ProxyAccountPicker } from '../src/pages/codexGui/ProxyAccountPicker';
import { RemoteAccountPicker } from '../../../shared/conversation/remote/RemoteAccountPicker';
import { ChatProfileMenu } from '../../../shared/remote-chat/views/ChatProfileMenu';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import type { GuiAccountsClient } from '../../../shared/remote-chat/guiAccounts';
import { useDesktopLayout } from '../../../shared/layout/useDesktopLayout';

const account = { ...DEMO_ACCOUNTS[0], active: true, email: 'quota@example.com', plan: 'Pro',
  usage: { primary: { remainingPercent: 74, usedPercent: 26 } } };
const noop = () => {};
const select = async () => true;
const client: GuiAccountsClient = {
  read: async () => ({ running: true, selection: { kind: 'account', id: account.id }, choices: [{
    kind: 'account', id: account.id, name: account.email, detail: 'Pro', available: true,
    plan: 'Pro', primaryRemainingPercent: 74, secondaryRemainingPercent: null,
  }] }),
  select: async selection => selection, subscribe: () => noop,
};
const guiTools = createGuiToolsClient(async () => { throw new Error('No live transport in this fixture'); });
const computers = { current: null, devices: [], authenticated: true, loading: false, error: '',
  refresh: noop, choose: noop, login: noop };

export function QuotaAccountFixture({ local, web }: { local: boolean; web: boolean }) {
  const desktop = useDesktopLayout();
  if (local) return <ProxyAccountPicker active privacyMode={false} accounts={[account]} providers={[]}
    aggregateApis={[]} busy={false} loading={false} onSwitchAccount={select} onSwitchProvider={select} />;
  if (web) return <ChatProfileMenu client={client} deviceName="Work PC" chooseDevice={noop} ready
    desktop={desktop} email="quota@example.com" guiTools={guiTools} running={false} />;
  return <RemoteAccountPicker active ready client={client} computers={computers} privacyMode={false} />;
}
