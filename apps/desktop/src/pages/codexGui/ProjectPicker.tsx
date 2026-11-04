import { uiText, guiLocale } from "../../../../../shared/localization/uiText";
import { ProjectExplorer } from '../../../../../shared/project-explorer/ProjectExplorer';
import { loadProjectExplorer, mutateProjectExplorer } from './projectExplorerClient';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { isDesktopApp } from '../../api/backend';
import { CreateProjectDialog } from './CreateProjectDialog';
import { folderName, projectName, readProjects, saveProject, type SavedProject } from '../../../../../shared/conversation/projectCatalog';
import { ProjectFolderPicker } from '../../../../../shared/conversation/ProjectFolderPicker';
import { WorkspacePicker } from '../../../../../shared/conversation/WorkspacePicker';
import { ConversationWorkspaceStatus } from '../../../../../shared/conversation/ConversationWorkspaceStatus';
import { useProjectFolderDrop } from './useProjectFolderDrop';
import { ProjectBar } from '../../../../../shared/conversation/ProjectBar';
import dropStyles from '../../../../../shared/conversation/ProjectPicker.module.less';
import layout from '../../../../../shared/conversation/styles.module.less';

interface ProjectPickerProps {
  value: string; projects: string[]; disabled: boolean;
  onChange: (cwd: string) => void; onError: (error: unknown) => void;
  gitEnabled?: boolean; onBusyChange?: (busy: boolean) => void; hostPicker?: ReactNode;
  actions?: ReactNode; running?: boolean; active?: boolean; dropTarget?: RefObject<HTMLElement>;
  dropState?: { dragging: boolean; reading: boolean };
}

export function ProjectPicker({ value, projects, disabled, onChange, onError,
  gitEnabled, onBusyChange, hostPicker, actions, running = false, active = true,
  dropTarget, dropState }: ProjectPickerProps) {
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [saved, setSaved] = useState(readProjects);
  const trigger = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const close = () => { setCreating(false); setBrowsing(false); trigger.current?.focus(); };
  useEffect(() => {
    if (disabled || !active || running) { setCreating(false); setBrowsing(false); }
  }, [disabled, active, running]);
  const create = (project: SavedProject) => {
    if (disabled) return;
    try {
      setSaved(saveProject(project)); onChange(project.path); close();
    } catch { onError(new Error(uiText("client.conversation.couldNotSaveTheProjectPleaseTryAgain"))); }
  };
  const folderDrop = useProjectFolderDrop({ target: dropTarget ?? bar,
    allowFileAttachments: true,
    enabled: !dropState && active && Boolean(gitEnabled) && !disabled && !creating && !browsing,
    onFolder: path => create({ path, name: projectName(path) }), onError });
  const drop = dropState ?? folderDrop;
  const trailing = <>
    {!running && !(gitEnabled && onBusyChange) && !hostPicker && <span className={layout.localLabel}>
      {isDesktopApp ? uiText("client.git.local") : uiText("client.conversation.remoteAiHost")}</span>}
    {hostPicker}
  </>;
  return <>
    <ProjectBar barRef={bar} active={active} scope={value} trailing={trailing}
      hint={(drop.dragging || drop.reading) && <div className={dropStyles.dropHint} role="status">
        <span>{drop.reading ? uiText("client.chat.addingAttachments")
          : uiText("client.composer.dropToAddFilesOrFolders")}</span>
      </div>}>
      <ProjectFolderPicker value={value} disabled={disabled || running} triggerRef={trigger}
        projects={[...saved, ...projects.map(path => ({ path, name: folderName(path) }))]}
        onChange={onChange} onClear={() => onChange('')} onOpen={() => setSaved(readProjects())}
        onBrowse={() => setBrowsing(true)}
        onAdd={() => setCreating(true)} addLabel={uiText("client.conversation.newProject")} />
      {(gitEnabled === false || running) && <ConversationWorkspaceStatus key={value} cwd={value}
        enabled={active} />}
      {!running && gitEnabled && onBusyChange && <WorkspacePicker key={value} cwd={value} disabled={disabled}
        onChange={onChange} onBusyChange={onBusyChange}
        localLabel={hostPicker ? uiText("client.conversation.worktree") : undefined} />}
      {actions}
    </ProjectBar>
    {creating && <CreateProjectDialog disabled={disabled} onCreate={create} onError={onError}
      onClose={close} />}
    {browsing && <ProjectExplorer cwd={value} load={loadProjectExplorer} mutate={mutateProjectExplorer}
      projects={[...saved.map(project => ({ cwd: project.path, label: project.name })),
        ...projects.map(path => ({ cwd: path, label: folderName(path) }))]}
      close={close} choose={project => create({ path: project.cwd, name: project.label })}
      t={uiText} locale={guiLocale()} />}
  </>;
}
