import { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import { Button, Spin } from 'antd';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { sshLabel } from '../../../../shared/terminal/sshProfiles';
import { useSshDiscovery } from '../../../../shared/terminal/useSshDiscovery';
import { SshQuickConnectDialog } from '../../../../shared/terminal/SshQuickConnectDialog';
import type { RemoteDevice } from '../types';
import { displayError, t, useLanguage } from '../i18n';
import { ChatDevices } from '../chat/ChatDevices';
import { ChatTerminal } from '../chat/ChatTerminal';
import { ChatTerminalLayout } from '../chat/ChatTerminalLayout';
import { DiscoveryBackButton } from './DiscoveryPage';
import './ssh.css';

export function SshPage({ client, connected, deviceName, devices, chooseDevice, onBack }: {
  client: GuiToolsClient['terminal']; connected: boolean; deviceName?: string;
  devices: RemoteDevice[]; chooseDevice: (id: string) => void; onBack: () => void;
}) {
  useLanguage();
  const { saved, profile, choose, close, panel } = useSshDiscovery(client, connected);
  const [picking, setPicking] = useState(false);
  return <section className="discovery-ssh-page" aria-label={t('client.discovery.ssh')}>
    <DiscoveryBackButton onBack={onBack} />
    <header className="discovery-ssh-heading"><h1>{t('client.discovery.ssh')}</h1>
      <button type="button" className="discovery-ssh-device" onClick={() => setPicking(true)}
        aria-label={t('client.settings.chooseAComputer')}>
        {deviceName || t('client.settings.chooseAComputer')}<ChevronDown size={18} />
      </button>
    </header>
    <div className="discovery-ssh-content">
      <div className="discovery-ssh-section"><span>{t('client.ssh.savedConnections')}</span>
        <Button aria-label={t('client.ssh.refresh')} loading={saved.loading}
          onClick={() => void saved.refresh()}>{t('client.ssh.refresh')}</Button></div>
      {!connected && <p className="discovery-ssh-hint">{t('client.discovery.sshComputerHint')}</p>}
      {!!saved.error && <p role="alert" className="chat-error">{displayError(saved.error)}</p>}
      {saved.profiles.map(item => <button type="button" key={item.id} className="discovery-ssh-connection"
        disabled={saved.loading || !!saved.error} onClick={() => choose(item)}>
        <Terminal size={24} aria-hidden="true" /><span><strong>{item.name || sshLabel(item)}</strong>
          {!!item.name && <small>{sshLabel(item)}</small>}</span><ChevronRight size={20} aria-hidden="true" />
      </button>)}
      {!saved.loading && !saved.error && !saved.profiles.length && <div className="discovery-ssh-empty">
        <strong>{t('client.ssh.noSavedConnections')}</strong><p>{t('client.ssh.emptyConnectionsHint')}</p>
      </div>}
      {profile && !connected && <div role="status" className="discovery-ssh-empty"><Spin />
        <p>{profile.name || sshLabel(profile)}</p><p>{t('client.discovery.sshComputerHint')}</p>
        <Button onClick={() => setPicking(true)}>{t('client.settings.chooseAComputer')}</Button>
        <Button aria-label={t('client.ssh.cancel')} onClick={close}>{t('client.ssh.cancel')}</Button>
      </div>}
    </div>
    <ChatTerminalLayout><ChatTerminal client={client} cwd="" active connected={connected}
      deviceName={deviceName} hideTrigger panel={panel} /></ChatTerminalLayout>
    {profile && connected && <SshQuickConnectDialog key={profile.id} api={client.ssh} profile={profile} projectCwd=""
      connected={panel.adopt} dispose={client.close} close={close} />}
    {picking && <ChatDevices devices={devices} onClose={() => setPicking(false)}
      choose={id => { setPicking(false); chooseDevice(id); }} />}
  </section>;
}
