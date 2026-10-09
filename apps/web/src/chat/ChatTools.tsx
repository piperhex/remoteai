import { useEffect, useState } from 'react';
import { Popover } from 'antd';
import { GitBranch, Monitor, SquareTerminal, Wrench } from 'lucide-react';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { ChatTerminal } from './ChatTerminal';
import { ChatGit } from './git/ChatGit';
import { RemoteDesktop } from './desktop/RemoteDesktop';
import { t } from '../i18n';
import './git/git.css';

interface Props {
  client: GuiToolsClient; cwd: string; active: boolean; connected: boolean; deviceName?: string;
}
export function ChatTools(props: Props) { return <ProjectTools key={props.cwd} {...props} />; }

function ProjectTools({ client, ...props }: Props) {
  const [menu, setMenu] = useState(false);
  const [launchId, setLaunchId] = useState(0);
  const [git, setGit] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { if (!props.active) setMenu(false); }, [props.active]);
  return <>
    <Popover trigger="click" placement="bottomRight" arrow={false} open={menu && props.active} onOpenChange={setMenu}
      content={<div className="chat-tools-menu">
        <button type="button" disabled={!props.connected}
          onClick={() => { setMenu(false); setDesktop(true); }}>
          <Monitor size={20} />{t('远程桌面')}</button>
        <button type="button" disabled={!props.connected}
          onClick={() => { setMenu(false); setLaunchId(value => value + 1); }}>
          <SquareTerminal size={20} />{t('终端')}</button>
        <button type="button" onClick={() => { setMenu(false); setGit(true); }}>
          <GitBranch size={20} />{t('Git')}</button>
      </div>}>
      <button type="button" className="chat-terminal-toggle" aria-label={t('打开工具')}
        aria-expanded={menu && props.active}>
        <Wrench size={22} /></button>
    </Popover>
    <ChatTerminal {...props} client={client.terminal} launchId={launchId} hideTrigger />
    {git && <ChatGit {...props} client={client.git} onClose={() => setGit(false)} />}
    {desktop && <RemoteDesktop client={client.desktop} active={props.active} connected={props.connected}
      close={() => setDesktop(false)} />}
  </>;
}
