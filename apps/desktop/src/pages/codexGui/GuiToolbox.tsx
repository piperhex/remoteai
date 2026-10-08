import { guiText } from "../../i18n/guiText";
import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, Popover } from 'antd';
import { GitBranch, Wrench } from 'lucide-react';
import type { GitClient } from '../../../../../shared/remote-chat/gitTypes';
import styles from './GuiToolbox.module.less';
import '../../../../web/src/chat/terminal.css';
import '../../../../web/src/chat/git/git.css';

const ChatGit = lazy(() => import('../../../../web/src/chat/git/ChatGit')
  .then(module => ({ default: module.ChatGit })));

interface Props {
  active: boolean; connected: boolean; cwd: string; deviceName: string;
  git: GitClient;
}

export function GuiToolbox(props: Props) {
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<'git' | null>(null);
  useEffect(() => { if (!props.active) { setMenu(false); setPanel(null); } }, [props.active]);
  return <>
    <Popover trigger="click" placement="bottomRight" open={menu && props.active} onOpenChange={setMenu}
      styles={{ root: { maxWidth: 400 } }} content={<div className={styles.menu} aria-label={guiText("工具箱")}>
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
    </Suspense>
  </>;
}
