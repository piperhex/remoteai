import { File, Package } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { FileDownloadButton } from '../downloads/FileDownloadButton';
import { t } from '../i18n';
import type { FilePreviewContext } from './ChatFilePreview';
import './filePreview.css';

const DOWNLOAD_ONLY_EXTENSIONS = new Set([
  'exe', 'msi', 'msix', 'apk', 'aab', 'dmg', 'pkg', 'deb', 'rpm', 'zip', '7z', 'rar', 'gz', 'tar', 'bz2', 'xz',
  'iso', 'bin', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mp3', 'wav', 'flac', 'ogg',
]);
const INSTALLER_FILE = /\.(?:exe|msi|msix|apk|aab|dmg|pkg|deb|rpm)$/i;

export function isDownloadOnlyFile(path: string) {
  const name = path.split(/[\\/]/).at(-1) || '';
  return name.includes('.') && DOWNLOAD_ONLY_EXTENSIONS.has(name.split('.').at(-1)!.toLowerCase());
}

export function ChatDownloadFile({ path, context, onClose }: {
  path: string; context: FilePreviewContext; onClose: () => void;
}) {
  const name = path.split(/[\\/]/).at(-1) || t('文件');
  const extension = name.split('.').at(-1)?.toUpperCase() || '';
  const Icon = INSTALLER_FILE.test(path) ? Package : File;
  return <AdaptiveSheet open title={t('文件下载')} width={448} className="chat-download-sheet" onClose={onClose}>
    <div className="chat-download-file">
      <div className="chat-download-file-heading">
        <div className="chat-download-file-icon"><Icon size={26} strokeWidth={1.5} aria-hidden="true" /></div>
        <div className="chat-download-file-info"><h3>{name}</h3>
          <span className="chat-download-file-type">{extension}</span></div>
      </div>
      <p className="chat-download-file-hint">{t('下载后即可用相应的应用打开。')}</p>
      <div className="chat-download-file-transfer"><FileDownloadButton path={path} context={context} /></div>
    </div>
  </AdaptiveSheet>;
}
