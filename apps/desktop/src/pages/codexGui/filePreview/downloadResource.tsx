import { Download } from 'lucide-react';
import { ResourceDownloadCard } from '../../../../../../shared/file-preview/ResourceDownloadCard';
import type { FilePreviewTarget } from './usePreviewHistory';
import { fileResourceKey, fileResourceUrl, type BrowserResource } from './browserResources';
import { useFileMenu } from '../useFileMenu';
import { uiText } from '../../../i18n/uiText';
import { downloadOrigin } from '../../../../../web/src/downloads/downloadFeedback';

function FileDownloadCard({ target }: { target: FilePreviewTarget }) {
  const menu = useFileMenu(target);
  return <ResourceDownloadCard path={target.path}>
    <button className="resource-download-button" type="button" disabled={menu.busy}
      onClick={event => { void menu.perform({ type: 'saveAs' }, downloadOrigin(event)); }}>
      <Download size={17} aria-hidden="true" />{uiText('client.projectBrowser.download')}
    </button>
  </ResourceDownloadCard>;
}

export function downloadBrowserResource(target: FilePreviewTarget): BrowserResource {
  return { key: fileResourceKey(target), title: target.path.split(/[\\/]/).at(-1) ?? target.path,
    url: fileResourceUrl(target.path), render: () => <FileDownloadCard target={target} /> };
}
