import { createProjectBrowserClient } from '../../../../../shared/project-browser/protocol';
import { ProjectBrowserButton } from '../../../../../shared/project-browser/views/ProjectBrowserButton';
import { guiApi } from '../../../../../shared/conversation/api';
import styles from '../../../../../shared/conversation/WorkspacePicker.module.less';
import { isDesktopApp } from '../../api/backend';
import { fileApi } from '../../../../../shared/conversation/fileApi';
import { browserHost } from '../../../../../shared/project-browser/views/browserHost';
import { projectDownloads } from '../../../../../shared/project-browser/downloads';

const client = createProjectBrowserClient(request => guiApi.request(request),
  projectDownloads(request => guiApi.request(request)));
const host = browserHost(client);
if (isDesktopApp) host.open = async entry => {
  await fileApi.perform({ path: entry.path, threadId: null },
    { type: 'open', application: entry.directory ? 'default' : 'explorer' });
};

export function LocalProjectBrowser(props: { cwd: string; active: boolean; connected: boolean }) {
  return <ProjectBrowserButton {...props} client={client} host={host} className={styles.trigger} desktopStyle />;
}
