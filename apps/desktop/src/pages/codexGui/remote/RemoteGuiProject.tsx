import { guiText } from "../../../i18n/guiText";
import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { Folder } from 'lucide-react';
import { ChatProjectPicker } from '../../../../../web/src/chat/ChatProjectPicker';
import type { ChatController, ChatState } from '../../../../../web/src/chat/types';
import { projectName } from '../projectCatalog';
import { GuiHostPicker } from '../GuiHostPicker';
import { WorkspacePicker } from '../WorkspacePicker';
import { GuiToolbox } from '../GuiToolbox';
import type { GuiComputerNavigation } from './types';
import styles from '../styles.module.less';

export function RemoteGuiProject({ state, controller, computers, active }: {
  state: ChatState; controller: ChatController; computers: GuiComputerNavigation; active: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const cwd = state.selected?.cwd ?? state.draftProject?.cwd ?? '';
  const canChoose = active && state.ready && !state.selected && !state.sending && !state.workspaceBusy;
  useEffect(() => { if (!canChoose) setPicking(false); }, [canChoose]);
  return <div className="gui-remote-project">
    <div className={styles.projectBar}>
      <Button type="text" icon={<Folder size={15} />} disabled={!canChoose}
        aria-label={guiText("选择远程项目")} title={cwd || undefined} onClick={() => setPicking(true)}>
        {cwd ? projectName(cwd) : guiText("选择项目")}
      </Button>
      {!state.selected && <WorkspacePicker key={cwd} cwd={cwd} disabled={!canChoose}
        remote localLabel={guiText("工作树")} enabled={active && state.ready}
        request={controller.guiTools.workspace} onBusyChange={controller.setWorkspaceBusy}
        onChange={path => controller.chooseDraftProject({ cwd: path, label: projectName(path) })} />}
      <GuiToolbox trigger="git" active={active} connected={state.ready && !state.workspaceBusy} cwd={cwd}
        deviceName={computers.current?.name ?? guiText("远程电脑")} git={controller.guiTools.git} />
      <GuiHostPicker navigation={computers} active={active} />
    </div>
    {picking && canChoose && <ChatProjectPicker cwd={cwd} load={controller.loadProjectDirectories}
      close={() => setPicking(false)} choose={project => {
        controller.chooseDraftProject(project); setPicking(false);
      }} />}
  </div>;
}
