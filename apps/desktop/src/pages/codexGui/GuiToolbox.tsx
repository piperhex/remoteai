import { guiText } from "../../i18n/guiText";
import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, Popover } from 'antd';
import { GitBranch, Monitor, Wrench } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import type { GitClient } from '../../../../../shared/remote-chat/gitTypes';
import type { DesktopClient } from '../../../../../shared/remote-desktop/protocol';
import { localDesktopClipboard } from '../../remoteDesktop/localClipboard';
import styles from './GuiToolbox.module.less';
import '../../../../web/src/chat/terminal.css';
import '../../../../web/src/chat/git/git.css';

const ChatGit = lazy(() => import('../../../../web/src/chat/git/ChatGit')
  .then(module => ({ default: module.ChatGit })));
const RemoteDesktop = lazy(() => import('../../../../web/src/chat/desktop/RemoteDesktop')
  .then(module => ({ default: module.RemoteDesktop })));

interface Props {
  active: boolean; connected: boolean; cwd: string; deviceName: string;
  git: GitClient; desktop?: DesktopClient;
}

export function GuiToolbox(props: Props) {
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<'git' | 'desktop' | null>(null);
  useEffect(() => { if (!props.active) { setMenu(false); setPanel(null); } }, [props.active]);
  return <>
    <Popover trigger="click" placement="bottomRight" open={menu && props.active} onOpenChange={setMenu}
      styles={{ root: { maxWidth: 400 } }} content={<div className={styles.menu} aria-label={guiText("工具箱")}>
        {props.desktop && <button type="button" disabled={!props.connected}
          onClick={() => { setMenu(false); setPanel('desktop'); }}>
          <Monitor size={18} /><span>{guiText("远程桌面")}</span>
        </button>}
        <button type="button" disabled={!props.connected} onClick={() => { setMenu(false); setPanel('git'); }}>
          <GitBranch size={18} /><span>Git</span></button>
      </div>}>
      <Button type="text" icon={<Wrench size={16} />} title={menu || panel ? undefined : guiText("工具箱")}
        aria-label={guiText("打开工具箱")} aria-expanded={menu && props.active} />
    </Popover>
    <Suspense fallback={null}>
      {panel === 'git' && <ChatGit key={props.cwd} client={props.git} cwd={props.cwd}
        connected={props.connected} active={props.active} deviceName={props.deviceName}
        onClose={() => setPanel(null)} />}
      {panel === 'desktop' && props.desktop && <RemoteDesktop client={props.desktop}
        nativeWindow={isTauri()}
        localClipboard={isTauri() ? localDesktopClipboard : undefined}
        active={props.active && props.connected} close={() => setPanel(null)} />}
    </Suspense>
  </>;
}
