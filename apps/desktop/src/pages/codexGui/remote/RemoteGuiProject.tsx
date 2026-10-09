import { guiText } from "../../../i18n/guiText";
import type { ChatController, ChatState } from '../../../../../web/src/chat/types';
import { directoryProject } from '../../../../../../shared/remote-chat/projectDirectories';
import { RemoteProjectPicker } from './RemoteProjectPicker';
import { GuiHostPicker } from '../GuiHostPicker';
import { WorkspacePicker } from '../WorkspacePicker';
import { GuiToolbox } from '../GuiToolbox';
import type { GuiComputerNavigation } from './types';
import styles from '../styles.module.less';

export function RemoteGuiProject({ state, controller, computers, active }: {
  state: ChatState; controller: ChatController; computers: GuiComputerNavigation; active: boolean;
}) {
  const cwd = state.selected?.cwd ?? state.draftProject?.cwd ?? '';
  const canChoose = active && state.ready && !state.selected && !state.sending && !state.workspaceBusy;
  return <div className="gui-remote-project">
    <div className={styles.projectBar}>
      <RemoteProjectPicker key={`${computers.current?.deviceId}:${state.selected?.id ?? 'draft'}`}
        state={state} controller={controller} active={active} />
      {!state.selected && <WorkspacePicker key={cwd} cwd={cwd} disabled={!canChoose}
        remote localLabel={guiText("工作树")} enabled={active && state.ready}
        request={controller.guiTools.workspace} onBusyChange={controller.setWorkspaceBusy}
        onChange={path => controller.chooseDraftProject(directoryProject(path))} />}
      <GuiToolbox trigger="git" active={active} connected={state.ready && !state.workspaceBusy} cwd={cwd}
        deviceName={computers.current?.name ?? guiText("远程电脑")} git={controller.guiTools.git} />
      <GuiHostPicker navigation={computers} active={active} />
    </div>
  </div>;
}
