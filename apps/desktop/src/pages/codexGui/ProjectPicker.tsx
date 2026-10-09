import { guiText } from '../../i18n/guiText';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isDesktopApp } from '../../api/backend';
import { CreateProjectDialog } from './CreateProjectDialog';
import { folderName, readProjects, saveProject, type SavedProject } from './projectCatalog';
import { ProjectFolderPicker } from './ProjectFolderPicker';
import { WorkspacePicker } from './WorkspacePicker';
import layout from './styles.module.less';

interface ProjectPickerProps {
  value: string; projects: string[]; disabled: boolean;
  onChange: (cwd: string) => void; onError: (error: unknown) => void;
  gitEnabled?: boolean; onBusyChange?: (busy: boolean) => void; hostPicker?: ReactNode;
}

export function ProjectPicker({ value, projects, disabled, onChange, onError,
  gitEnabled, onBusyChange, hostPicker }: ProjectPickerProps) {
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState(readProjects);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setCreating(false); trigger.current?.focus(); };
  useEffect(() => { if (disabled) setCreating(false); }, [disabled]);
  const create = (project: SavedProject) => {
    if (disabled) return;
    try {
      setSaved(saveProject(project)); onChange(project.path); close();
    } catch { onError(new Error(guiText('项目未能保存，请重试。'))); }
  };
  return <div className={layout.projectBar}>
    <ProjectFolderPicker value={value} disabled={disabled} triggerRef={trigger}
      projects={[...saved, ...projects.map(path => ({ path, name: folderName(path) }))]}
      onChange={onChange} onClear={() => onChange('')} onOpen={() => setSaved(readProjects())}
      onAdd={() => setCreating(true)} addLabel={guiText('新建项目')} />
    {gitEnabled && onBusyChange ? <WorkspacePicker key={value} cwd={value} disabled={disabled}
      onChange={onChange} onBusyChange={onBusyChange} localLabel={hostPicker ? guiText('工作树') : undefined} />
      : !hostPicker && <span className={layout.localLabel}>
        {isDesktopApp ? guiText('本地') : guiText('Remote AI 主机')}</span>}
    {hostPicker}
    {creating && <CreateProjectDialog disabled={disabled} onCreate={create} onError={onError}
      onClose={close} />}
  </div>;
}
