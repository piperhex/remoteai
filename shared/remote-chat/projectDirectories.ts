import type { ChatProject } from './client/types';

export interface ProjectDirectory {
  name: string; path: string;
  /** Older hosts only return folders. */
  directory?: boolean; modified?: number | null; size?: number | null;
}
export interface ProjectDirectoriesResponse {
  directory: string;
  parent: string | null;
  entries: ProjectDirectory[];
  truncated: boolean;
  /** Known folders on the host computer; older hosts may omit them. */
  shortcuts?: Partial<Record<'home' | 'desktop' | 'downloads', string | null>>;
}
export interface ProjectPickerProps {
  title?: string;
  cwd?: string;
  load: (directory: string, includeFiles?: boolean) => Promise<ProjectDirectoriesResponse>;
  mutate?: import('../project-browser/protocol').ProjectBrowserClient['mutate'];
  projects?: { cwd: string; label: string }[];
  choose: (project: ChatProject) => void;
  close: () => void;
}

export function directoryProject(directory: string): ChatProject {
  const label = directory.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || directory;
  return { cwd: directory, label };
}
