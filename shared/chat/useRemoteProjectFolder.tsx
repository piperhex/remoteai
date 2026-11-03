import { useEffect, useState } from 'react';
import { getInterfaceLanguage } from '../localization/interfaceLanguage';
import { localeForLanguage } from '../localization/language';
import type { MessageTranslator } from '../localization/messages';
import { ProjectExplorer } from '../project-explorer/ProjectExplorer';
import type { ChatController } from '../remote-chat/client/controller';
import type { ChatState } from '../remote-chat/client/types';
import { threadPresentation } from '../remote-chat/sidebar';

/** Browse the remote project's files without changing the selected conversation or project. */
export function useRemoteProjectFolder({ controller, state, translate }: {
  controller: Pick<ChatController, 'loadProjectDirectories' | 'guiTools'>;
  state: ChatState; translate: MessageTranslator;
}) {
  const [cwd, setCwd] = useState('');
  useEffect(() => { if (!state.ready) setCwd(''); }, [state.ready]);
  const close = () => setCwd('');
  const openProject = async (path: string): Promise<void> => {
    if (state.ready && path) setCwd(path);
  };
  const projects = cwd ? state.threads.map(thread => {
    const view = threadPresentation(thread, state.sidebar);
    return { cwd: view.cwd, label: view.projectName };
  }).filter(project => project.cwd) : [];
  const projectFolderDialog = cwd && state.ready ? <ProjectExplorer key={cwd} mode="browse" cwd={cwd}
    title={translate('client.mobile.browseProjectFiles')} t={translate}
    locale={localeForLanguage(getInterfaceLanguage())} load={controller.loadProjectDirectories}
    mutate={controller.guiTools.projectBrowser.mutate} projects={projects} close={close} /> : null;
  return { openProject, projectFolderDialog };
}
