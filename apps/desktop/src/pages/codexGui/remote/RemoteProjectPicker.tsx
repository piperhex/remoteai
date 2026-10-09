import { useEffect, useRef, useState } from 'react';
import { guiText } from '../../../i18n/guiText';
import { ChatProjectPicker } from '../../../../../web/src/chat/ChatProjectPicker';
import type { ChatProject, ChatState } from '../../../../../../shared/remote-chat/client/types';
import type { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import { canSelectProject } from '../../../../../../shared/remote-chat/projects';
import { directoryProject } from '../../../../../../shared/remote-chat/projectDirectories';
import { ProjectFolderPicker } from '../ProjectFolderPicker';

export function RemoteProjectPicker({ state, controller, active }: {
  state: ChatState; controller: ChatController; active: boolean;
}) {
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cwd = state.selected?.cwd ?? state.draftProject?.cwd ?? '';
  const disabled = !active || !canSelectProject(state);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (disabled) setPicking(false); }, [disabled]);
  const load = async () => {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError('');
    try {
      const result = await controller.guiTools.projects.list();
      if (mounted.current) setProjects(result);
    } catch {
      if (mounted.current) setError(guiText('项目列表未能加载，请重新打开重试。'));
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  const close = () => { setPicking(false); trigger.current?.focus(); };
  const choose = (project: ChatProject) => { close(); void controller.selectProject(project); };
  const known = [...projects, ...state.threads.filter(thread => thread.cwd).map(thread => directoryProject(thread.cwd))];
  return <>
    <ProjectFolderPicker value={cwd} disabled={disabled} triggerRef={trigger}
      ariaLabel={guiText('选择远程项目')} projects={known.map(project => ({ path: project.cwd, name: project.label }))}
      loading={loading} error={error} onOpen={() => void load()}
      onChange={path => choose(directoryProject(path))} onAdd={() => setPicking(true)}
      addLabel={guiText('选择其他文件夹…')}
      onClear={state.selected ? undefined : () => { void controller.selectProject(null); }} />
    {picking && !disabled && <ChatProjectPicker cwd={cwd} load={controller.loadProjectDirectories}
      close={close} choose={choose} />}
  </>;
}
