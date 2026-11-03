import { uiText } from "../../../i18n/uiText";
import { remoteErrorText } from "../../../../../../shared/localization/errors";
import { useState } from 'react';
import { Alert, Button, Popover, Tooltip } from 'antd';
import { PanelBottom, RefreshCw } from 'lucide-react';
import type { ChatState } from '../../../../../../shared/remote-chat/client/types';
import type { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import type { TerminalPanelState } from '../terminal/useTerminalPanel';
import { Installer } from '../Installer';
import { CliUpdateIcon } from '../CliUpdateIcon';
import { GuiChatSettingsButton } from '../GuiChatSettingsButton';
import { PanelToggleButton } from '../../../../../../shared/chat/PanelToggleButton';
import type { useRemoteCliInstaller } from './useRemoteCliInstaller';

export function RemoteGuiTools({ controller, state, installer, terminal, active }: {
  controller: ChatController; state: ChatState; installer: ReturnType<typeof useRemoteCliInstaller>;
  terminal?: TerminalPanelState & { error?: string; busy?: boolean };
  active: boolean;
}) {
  const connected = state.mode === 'direct' || state.mode === 'relay';
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState('');
  const running = state.sending || Boolean(state.selected?.turns?.some(turn => turn.status === 'inProgress'));
  const terminalLabel = terminal?.open ? uiText("client.chat.hideRemoteTerminal") : uiText("client.chat.openRemoteTerminal");
  const reconnect = async () => {
    if (reconnecting) return;
    if (!connected) { controller.connectNow(); return; }
    setReconnecting(true); setError('');
    try { await controller.guiTools.reconnect(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : uiText("client.workspaceActions.couldNotReconnectRemoteCodexPleaseTryAgainShortly")); }
    finally { setReconnecting(false); }
  };
  return <div className="gui-remote-tools">
    <GuiChatSettingsButton active={active} />
    <Tooltip title={uiText("client.workspaceActions.reconnectRemoteCodex")} styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" className="gui-remote-secondary-tool"
        icon={<RefreshCw size={16} />} aria-label={uiText("client.workspaceActions.reconnectRemoteCodex")}
        loading={reconnecting || state.connecting} disabled={running || installer.installing}
        onClick={() => { void reconnect(); }} />
    </Tooltip>
    <Popover trigger="click" placement="bottomRight" styles={{ root: { maxWidth: 400 } }} content={<>
      <Installer installer={installer} compact remote running={running} disabled={!connected} />
      {installer.error && <Alert type="error" message={remoteErrorText(installer.error)} />}
    </>}>
      <Button type="text" className="gui-remote-secondary-tool"
        icon={<CliUpdateIcon version={installer.version} release={installer.release} />}
        aria-label={uiText("client.workspaceActions.remoteCodexCliUpdates")} />
    </Popover>
    {terminal && <PanelToggleButton icon={<PanelBottom size={16} />} label={terminalLabel}
      expanded={terminal.open} active={terminal.tabs.length > 0}
      disabled={terminal.busy || (!connected && !terminal.open)}
      onClick={terminal.toggle} />}
    {terminal?.error && !terminal.open && <span role="alert" style={{ maxWidth: 400 }}>
      {remoteErrorText(terminal.error)}
    </span>}
    {error && <Popover open content={<Alert type="error" message={remoteErrorText(error)} closable onClose={() => setError('')} />}
      placement="bottomRight" styles={{ root: { maxWidth: 400 } }}><span /></Popover>}
  </div>;
}
