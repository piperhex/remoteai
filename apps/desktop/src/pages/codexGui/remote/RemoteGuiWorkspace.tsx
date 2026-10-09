import { lazy, Suspense, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import { ConnectedChat } from '../../../../../web/src/chat/ConnectedChat';
import { FocusModeButton, type GuiFocusMode } from '../FocusModeButton';
import { RemoteAccountPicker } from './RemoteAccountPicker';
import { useRemoteGui } from './useRemoteGui';
import type { GuiCloudIdentity, GuiComputer, GuiComputerNavigation } from './types';
import { useDreamSkin } from '../useDreamSkin';
import { RemoteGuiSidebar } from './RemoteGuiSidebar';
import { RemoteGuiProject } from './RemoteGuiProject';
import { readClipboardImages } from '../clipboardImages';
import { useRemoteTerminalPanel } from '../../../../../../shared/remote-chat/useRemoteTerminalPanel';
import { remoteTerminalApi } from './terminalApi';
import { RemoteGuiTools } from './RemoteGuiTools';
import { GuiRemoteDesktop } from '../GuiRemoteDesktop';
import styles from '../styles.module.less';
import './remoteGui.less';
import { useDesktopDownloads } from '../../../downloads/useDesktopDownloads';

const TerminalPanel = lazy(() => import('../terminal/TerminalPanel'));

export default function RemoteGuiWorkspace(props: {
  active: boolean; identity: GuiCloudIdentity; device: GuiComputer; computers: GuiComputerNavigation;
  privacyMode: boolean; focusMode: GuiFocusMode; windowControls?: ReactNode;
}) {
  const { active, identity, device, computers } = props;
  const chat = useRemoteGui(identity, device.deviceId, active);
  useDesktopDownloads({ identity, device, controller: chat.controller });
  const terminal = useRemoteTerminalPanel({ client: chat.controller.guiTools.terminal, connected: chat.state.ready,
    cwd: chat.state.selected?.cwd ?? chat.state.draftProject?.cwd ?? '' });
  const terminalApi = useMemo(() => remoteTerminalApi(chat.controller.guiTools.terminal), [chat.controller]);
  const skinStyle = useDreamSkin(active);
  const workspace = useRef<HTMLElement>(null);
  const popupContainer = useCallback(() => workspace.current ?? document.body, []);
  const accountPicker = <RemoteAccountPicker active={active} ready={chat.state.ready}
    client={chat.controller.guiAccounts} computers={computers} privacyMode={props.privacyMode} />;
  return <section ref={workspace} className={`${styles.page} chat-page gui-remote-workspace`}
    data-dream-skin={skinStyle ? 'true' : undefined} style={skinStyle} aria-label={`Codex GUI：${device.name}`}>
    <ConfigProvider getPopupContainer={popupContainer}>
    <ConnectedChat chat={chat} active={active} device={device} devices={computers.devices} email="" desktopDiffs
      scope={JSON.stringify([identity.baseUrl, identity.userId, device.deviceId])}
      chooseLocal={() => computers.choose(null)}
      chooseDevice={(id) => { const device = computers.devices.find((entry) => entry.deviceId === id);
        if (device) computers.choose(device); }}
      headerConnectionActions={<GuiRemoteDesktop client={chat.controller.guiTools.desktop} active={active}
        connected={chat.state.mode === 'direct' || chat.state.mode === 'relay'} />}
      headerActions={<><RemoteGuiTools controller={chat.controller} state={chat.state} active={active}
        terminal={terminal} />
        <span className="gui-remote-focus"><FocusModeButton {...props.focusMode} /></span></>}
      headerEnd={props.focusMode.focused && props.windowControls}
      conversationFooter={terminal.tabs.length > 0 && <Suspense fallback={null}>
        <TerminalPanel panel={terminal} active={active} api={terminalApi} notice={terminal.error} />
      </Suspense>}
      readClipboardImages={readClipboardImages}
      composerHeader={<RemoteGuiProject state={chat.state} controller={chat.controller} computers={computers}
        active={active} />}
      renderSidebar={actions => <RemoteGuiSidebar state={chat.state} controller={chat.controller}
        actions={actions} accountPicker={accountPicker} focusMode={props.focusMode} />} />
    </ConfigProvider>
  </section>;
}
