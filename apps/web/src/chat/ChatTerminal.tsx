import { displayText } from '../i18n/index';
import { displayError } from '../i18n/index';
import { lazy, Suspense, useContext, useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChatTerminalHostContext } from './ChatTerminalLayout';
import { Drawer, Spin } from 'antd';
import { PanelToggleButton } from '../../../../shared/chat/PanelToggleButton';
import { PanelBottom, SquareTerminal } from 'lucide-react';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { useRemoteTerminalLauncher } from '../../../../shared/remote-chat/useRemoteTerminalLauncher';
import { remoteTerminalApi } from '../../../../shared/remote-chat/terminalApi';
import { useDesktopLayout } from '../useDesktopLayout';
import { t, useLanguage } from '../i18n';
import './terminal.css';
import { useToolLaunch } from '../../../../shared/remote-chat/useToolLaunch';

const TerminalPanel = lazy(() => import('../../../desktop/src/pages/codexGui/terminal/TerminalPanel'));
const PHONE_LANDSCAPE = '(pointer: coarse) and (orientation: landscape) and (max-height: 500px)';
const subscribeLandscape = (notify: () => void) => {
  const query = window.matchMedia(PHONE_LANDSCAPE);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

interface Props {
  client: GuiToolsClient['terminal']; cwd: string; active: boolean; connected: boolean; deviceName?: string;
  launchId?: number; hideTrigger?: boolean;
}
export type ChatTerminalPanel = ReturnType<typeof useRemoteTerminalLauncher>;

/** Switching projects detaches the view; each PC retains the project's terminal sessions. */
export function ChatTerminal(props: Props & { panel?: ChatTerminalPanel }) {
  return props.panel ? <TerminalView {...props} panel={props.panel} /> : <StandaloneTerminal {...props} />;
}

function StandaloneTerminal(props: Props) {
  const panel = useRemoteTerminalLauncher(props);
  return <TerminalView {...props} panel={panel} />;
}

function TerminalView({ client, active, connected, deviceName, launchId = 0, hideTrigger = false, panel }:
  Props & { panel: ChatTerminalPanel }) {
  useLanguage();
  const desktop = useDesktopLayout();
  const phoneLandscape = useSyncExternalStore(subscribeLandscape,
    () => window.matchMedia(PHONE_LANDSCAPE).matches, () => false);
  const docked = desktop && !phoneLandscape;
  const host = useContext(ChatTerminalHostContext);
  const api = useMemo(() => remoteTerminalApi(client), [client]);
  const visible = active && panel.open;
  useToolLaunch(launchId, panel.toggle, connected && !panel.busy);
  const label = visible ? t("client.chat.hideRemoteTerminal") : t("client.chat.openRemoteTerminal");
  const empty = <div className="chat-terminal-empty">
    {panel.busy ? <div className="chat-terminal-loading"><Spin />{t("client.chat.openingTerminal")}</div>
      : <>{panel.error && <p role="alert">{displayError(panel.error)}</p>}
        <button type="button" className="chat-button" disabled={!connected} onClick={panel.retry}>
          {panel.error ? t("client.terminal.retry") : t("client.chat.newTerminal")}</button></>}
  </div>;
  const content = <Suspense
    fallback={<div className="chat-terminal-loading"><Spin />{t("client.chat.openingTerminal")}</div>}>
    <TerminalPanel panel={panel} api={api} active={visible} fill={!docked} translate={displayText}
      notice={panel.tabs.length ? panel.error : undefined} empty={empty} />
  </Suspense>;
  return <>
    {!hideTrigger && (desktop ? <PanelToggleButton icon={<PanelBottom size={16} />} label={label}
      expanded={Boolean(visible)} disabled={panel.busy || (!connected && !panel.tabs.length && !panel.error)}
      onClick={panel.toggle} /> : <button type="button" className="chat-terminal-toggle" aria-label={label} data-error={!!panel.error}
      aria-expanded={visible} disabled={panel.busy || (!connected && !panel.tabs.length && !panel.error)}
      onClick={panel.toggle}>
      <SquareTerminal size={22} /></button>)}
    {(panel.open || panel.tabs.length > 0) && (docked ? host && createPortal(content, host)
      : <Drawer open={visible} placement="bottom" height="90%"
      title={t("client.chat.remoteTerminal")} extra={<span className="chat-terminal-device">{deviceName}</span>}
      rootClassName="chat-terminal-drawer" onClose={panel.hide}
      closable={{ 'aria-label': t("client.chat.hideTerminal"), placement: 'end' }}>
      {content}
    </Drawer>)}
  </>;
}
