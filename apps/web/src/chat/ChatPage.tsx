import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { usePagePreview } from '../../../../shared/navigation/PageSwipeContext';
import { useAppDispatch } from '../hooks';
import { chatDeviceSelected } from '../store';
import type { AuthSession, RemoteDevice } from '../types';
import { ConnectedChat } from './ConnectedChat';
import { ChatTokenSummary } from './ChatTokenSummary';
import { SshPage } from '../discovery/SshPage';
import { ChatTools } from './ChatTools';
import { useChat } from './useChat';
import { useChatViewport } from './useChatViewport';
import { loadLastConnectedDevice, saveLastConnectedDevice } from './lastConnectedDevice';
import { useDownloadConnection } from '../downloads/useDownloadConnection';
import { useRetainedChatDevices } from '../../../../shared/remote-chat/useRetainedChatDevices';
import type { ComputerListRefresh } from '../../../../shared/remote-chat/ComputerSearchBar';
import { useComputerListRefresh } from './useComputerListRefresh';
import { useDesktopLayout } from '../useDesktopLayout';
import { useRemoteCliInstaller } from '../../../../shared/remote-chat/useRemoteCliInstaller';
import { useRemoteTerminalLauncher } from '../../../../shared/remote-chat/useRemoteTerminalLauncher';
import { TerminalWorkspaceProvider } from '../../../../shared/terminal/TerminalWorkspaceProvider';
import { GuiRemoteDesktop } from '../../../desktop/src/pages/codexGui/GuiRemoteDesktop';
import { RemoteGuiTools } from '../../../desktop/src/pages/codexGui/remote/RemoteGuiTools';
import { RemoteGuiProject } from '../../../desktop/src/pages/codexGui/remote/RemoteGuiProject';
import './desktopTools.css';

interface Props {
  session: AuthSession; devices: RemoteDevice[]; active: boolean; openAccounts?: () => void;
  tokenSummary: boolean; closeTokenSummary: () => void;
  sshDiscovery?: boolean; closeSshDiscovery?: () => void;
}

export function ChatPage({ session, devices, active, openAccounts,
  tokenSummary, closeTokenSummary, sshDiscovery, closeSshDiscovery }: Props) {
  useLanguage();
  const preview = usePagePreview() === 'chat';
  const dispatch = useAppDispatch();
  const deviceRefresh = useComputerListRefresh();
  const [lastConnectedDeviceId] = useState(() => loadLastConnectedDevice(session));
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const device = devices.find((entry) => entry.deviceId === deviceId)
    ?? devices.find((entry) => entry.deviceId === lastConnectedDeviceId && entry.online)
    ?? devices.find((entry) => entry.online);
  useEffect(() => {
    if (device && deviceId !== device.deviceId) setDeviceId(device.deviceId);
  }, [deviceId, device?.deviceId]);
  useEffect(() => {
    dispatch(chatDeviceSelected(device?.deviceId ?? null));
  }, [dispatch, device?.deviceId]);
  useChatViewport(active);
  const scope = JSON.stringify([session.baseUrl, session.email]);
  const retained = useRetainedChatDevices({ scope, devices, selectedId: device?.deviceId });
  const chats = device ? retained : [...retained, undefined];
  const chooseDevice = (id: string) => {
    setDeviceId(id);
  };
  return <section className="chat-page" hidden={!active && !preview} aria-label={t("client.chat.codexChat")}>
    {chats.map(chatDevice => {
      const selected = chatDevice?.deviceId === device?.deviceId;
      return <div className="chat-device-session" hidden={!selected}
        key={JSON.stringify([scope, chatDevice?.deviceId])}>
        <WebChat session={session} device={chatDevice} devices={devices} selected={selected}
          tokenSummary={tokenSummary && selected} closeTokenSummary={closeTokenSummary}
          sshDiscovery={sshDiscovery && selected} closeSshDiscovery={closeSshDiscovery}
          openAccounts={openAccounts}
          active={active && selected} chooseDevice={chooseDevice} deviceRefresh={deviceRefresh} />
      </div>;
    })}
  </section>;
}

function WebChat({ session, device, selected, ...props }: Props & {
  device?: RemoteDevice; selected: boolean; chooseDevice: (id: string) => void;
  deviceRefresh: ComputerListRefresh;
}) {
  const chat = useChat(session, device?.deviceId ?? '', props.active && Boolean(device));
  const desktop = useDesktopLayout();
  const cwd = chat.state.selected?.cwd ?? chat.state.draftProject?.cwd ?? '';
  const terminal = useRemoteTerminalLauncher({ client: chat.controller.guiTools.terminal,
    cwd, connected: chat.state.ready });
  const installer = useRemoteCliInstaller(chat.controller.guiTools,
    desktop && props.active && chat.foreground && chat.state.ready);
  useEffect(() => {
    if (selected && chat.state.ready && device) saveLastConnectedDevice(session, device.deviceId);
  }, [selected, chat.state.ready, device?.deviceId, session.baseUrl, session.email]);
  useDownloadConnection({ session, deviceId: device?.deviceId ?? '', deviceName: device?.name ?? '',
    controller: chat.controller, enabled: selected });
  return <TerminalWorkspaceProvider panel={terminal}>
    {props.sshDiscovery && <SshPage client={chat.controller.guiTools.terminal} connected={chat.state.ready}
      deviceName={device?.name} devices={props.devices} chooseDevice={props.chooseDevice}
      onBack={props.closeSshDiscovery!} />}
    {props.tokenSummary && <ChatTokenSummary read={chat.controller.readTokenSummary} ready={chat.state.ready}
      scope={JSON.stringify([session.baseUrl, session.email, device?.deviceId ?? ''])}
      deviceName={device?.name} onClose={props.closeTokenSummary} />}
    <div hidden={props.sshDiscovery} style={{ display: props.sshDiscovery ? 'none' : 'contents' }}>
    <ConnectedChat {...props} active={props.active && !props.sshDiscovery} chat={chat} device={device} email={session.email}
    cliVersion={installer.version}
    composerHeader={desktop && <RemoteGuiProject state={chat.state} controller={chat.controller}
      active={props.active && chat.foreground} computers={{ ...props.deviceRefresh, allowLocal: false,
        current: device ?? null, devices: props.devices, authenticated: true, login: () => {},
        choose: selected => { if (selected) props.chooseDevice(selected.deviceId); } }} />}
    headerActions={<div className="chat-header-tools">
      <ChatTools client={chat.controller.guiTools} active={props.active} terminal={terminal}
        desktopActions={<><GuiRemoteDesktop client={chat.controller.guiTools.desktop} active={props.active}
          connected={chat.state.mode === 'direct' || chat.state.mode === 'relay'} />
          <RemoteGuiTools controller={chat.controller} state={chat.state} installer={installer} active={props.active} /></>}
        connected={chat.state.ready} deviceName={device?.name}
        cwd={cwd} />
    </div>}
    scope={JSON.stringify([session.baseUrl, session.email, device?.deviceId ?? ''])} />
    </div>
  </TerminalWorkspaceProvider>;
}
