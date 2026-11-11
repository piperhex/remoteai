import { lazy, Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import { ConnectedChat } from '../../../../../../shared/remote-chat/views/ConnectedChat';
import { FocusModeButton, type GuiFocusMode } from '../FocusModeButton';
import { RemoteAccountPicker } from '../../../../../../shared/conversation/remote/RemoteAccountPicker';
import { useRemoteGui } from './useRemoteGui';
import type { GuiCloudIdentity, GuiComputer, GuiComputerNavigation } from '../../../../../../shared/conversation/remote/types';
import { useDreamSkin } from '../useDreamSkin';
import { RemoteGuiSidebar } from './RemoteGuiSidebar';
import { RemoteGuiProject } from '../../../../../../shared/conversation/remote/RemoteGuiProject';
import { readClipboardImages } from '../clipboardImages';
import { readDroppedFiles, subscribeFileDrop } from '../fileDrop';
import { isDesktopApp } from '../../../api/backend';
import { useRemoteTerminalPanel } from '../../../../../../shared/remote-chat/useRemoteTerminalPanel';
import { TerminalWorkspaceProvider } from '../../../../../../shared/terminal/TerminalWorkspaceProvider';
import { remoteTerminalApi } from './terminalApi';
import { useTerminalLinkTunnels } from '../terminal/useTerminalLinkTunnels';
import { RemoteGuiTools } from '../../../../../../shared/conversation/remote/RemoteGuiTools';
import { useRemoteCliInstaller } from '../../../../../../shared/conversation/remote/useRemoteCliInstaller';
import { GuiRemoteDesktop } from '../../../../../../shared/conversation/GuiRemoteDesktop';
import styles from '../../../../../../shared/conversation/styles.module.less';
import './remoteGui.less';
import { useDesktopDownloads } from '../../../downloads/useDesktopDownloads';
import { RemoteFileEnvironment } from './RemoteFileEnvironment';
import { PortForwarding } from '../portForwarding/PortForwarding';
import { RemoteUserMessage } from './RemoteUserMessage';
import { RemoteConversationSync } from './RemoteConversationSync';
import { RemoteGuiSettingsDialog } from './RemoteGuiSettingsDialog';
import { uiText } from '../../../../../../shared/localization/uiText';

const TerminalPanel = lazy(() => import('../../../../../../shared/terminal/views/TerminalPanel'));
const nativeFileDrop = { subscribe: subscribeFileDrop, readFiles: readDroppedFiles };

export default function RemoteGuiWorkspace(props: {
  active: boolean; identity: GuiCloudIdentity; device: GuiComputer; computers: GuiComputerNavigation;
  privacyMode: boolean; focusMode: GuiFocusMode; windowControls?: ReactNode;
}) {
  const { active, identity, device, computers } = props;
  const [syncing, setSyncing] = useState(false);
  const chat = useRemoteGui(identity, device.deviceId, active);
  const [workspaceCwd, setWorkspaceCwd] = useState('');
  const installer = useRemoteCliInstaller(chat.controller.guiTools,
    active && (chat.state.mode === 'direct' || chat.state.mode === 'relay'));
  const scope = JSON.stringify([identity.baseUrl, identity.userId, device.deviceId]);
  useDesktopDownloads({ identity, device, controller: chat.controller });
  const terminal = useRemoteTerminalPanel({ client: chat.controller.guiTools.terminal, connected: chat.state.ready,
    cwd: workspaceCwd });
  const resolveLink = useTerminalLinkTunnels(chat.controller.guiTools.terminal);
  const terminalApi = useMemo(() => remoteTerminalApi(chat.controller.guiTools.terminal, resolveLink),
    [chat.controller, resolveLink]);
  const skinStyle = useDreamSkin(active);
  const workspace = useRef<HTMLElement>(null);
  const popupContainer = useCallback(() => workspace.current ?? document.body, []);
  const accountPicker = <RemoteAccountPicker active={active} ready={chat.state.ready}
    client={chat.controller.guiAccounts} computers={computers} privacyMode={props.privacyMode}
    renderSettings={onClose => <RemoteGuiSettingsDialog client={chat.controller.guiTools.settings}
      privacyMode={props.privacyMode} onClose={onClose} />} />;
  return <section ref={workspace} className={`${styles.page} chat-page gui-remote-workspace`}
    data-dream-skin={skinStyle ? 'true' : undefined} style={skinStyle}
    aria-label={uiText("client.agentHub.workspace", { device: device.name })}>
    <ConfigProvider getPopupContainer={popupContainer}>
    <TerminalWorkspaceProvider panel={terminal}>
    <RemoteFileEnvironment controller={chat.controller} ready={chat.state.ready} threadId={chat.state.selected?.id ?? null}>
    <ConnectedChat chat={chat} active={active} device={device} devices={computers.devices} email="" desktopDiffs
      workspacePage={syncing ? { title: uiText('client.workspaceSettings.conversationSync'),
        onClose: () => setSyncing(false),
        content: <RemoteConversationSync identity={identity} devices={computers.devices} device={device} active={active}
          onSynced={() => { void chat.controller.list(); }} /> } : undefined}
      cliVersion={installer.version}
      renderUserMessage={props => <RemoteUserMessage {...props} state={chat.state}
        controller={chat.controller} active={active} />}
      scope={scope} draggableHeader={isDesktopApp} scrollableComposer onWorkspaceChange={setWorkspaceCwd}
      chooseLocal={() => computers.choose(null)}
      deviceRefresh={computers}
      chooseDevice={(id) => { const device = computers.devices.find((entry) => entry.deviceId === id);
        if (device) computers.choose(device); }}
      headerConnectionActions={<>
        {isDesktopApp && <PortForwarding client={chat.controller.guiTools.files} scope={scope}
          active={active} connected={chat.state.ready} />}
        <GuiRemoteDesktop client={chat.controller.guiTools.desktop} active={active}
          connected={chat.state.mode === 'direct' || chat.state.mode === 'relay'} /></>}
      headerActions={<>
        <RemoteGuiTools controller={chat.controller} state={chat.state} active={active}
        installer={installer} terminal={terminal} settings={null} />
        <span className="gui-remote-focus"><FocusModeButton {...props.focusMode} /></span></>}
      headerEnd={props.focusMode.focused && props.windowControls
        && <div className={styles.focusWindowControls}>{props.windowControls}</div>}
      conversationFooter={(terminal.open || terminal.tabs.length > 0) && <Suspense fallback={null}>
        <TerminalPanel panel={terminal} active={active && !syncing} api={terminalApi} notice={terminal.error} />
      </Suspense>}
      readClipboardImages={readClipboardImages}
      nativeFileDrop={isDesktopApp ? nativeFileDrop : undefined}
      composerHeader={<RemoteGuiProject state={chat.state} controller={chat.controller} computers={computers}
        active={active} />}
      renderSidebar={actions => <RemoteGuiSidebar state={chat.state} controller={chat.controller}
        actions={{ ...actions, newChat: project => { setSyncing(false); actions.newChat(project); },
          onClose: () => { setSyncing(false); actions.onClose(); } }}
        syncing={syncing} onOpenSync={() => setSyncing(true)}
        accountPicker={accountPicker} focusMode={props.focusMode} />} />
    </RemoteFileEnvironment>
    </TerminalWorkspaceProvider>
    </ConfigProvider>
  </section>;
}
