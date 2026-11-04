import { Download } from 'lucide-react';
import { DownloadCountIcon } from '../../../../shared/downloads/DownloadCountIcon';
import { LOCAL_DOWNLOAD_OWNER } from './localGitDownloads';

export function DownloadNavigationIcon({ owner }: { owner?: string }) {
  return <DownloadCountIcon owners={[owner, LOCAL_DOWNLOAD_OWNER]} target>
    <Download size={19} aria-hidden="true" />
  </DownloadCountIcon>;
}
