import { Download, Pause, Play, X } from 'lucide-react';
import { t } from '../i18n';
import './fileDownload.css';

type DownloadAction = 'download' | 'cancel' | 'pause' | 'resume' | 'save';
const ACTIONS = {
  download: { label: '下载', Icon: Download }, cancel: { label: '取消下载', Icon: X },
  pause: { label: '暂停下载', Icon: Pause }, resume: { label: '继续下载', Icon: Play },
  save: { label: '保存到设备', Icon: Download },
};
interface Props {
  action: DownloadAction; onAction: () => void; disabled: boolean;
  progress?: { percent?: number; status: string; detail: string };
  message?: string; note?: string;
}

/** Keep transfer progress separate from the action so button labels stay stable. */
export function FileDownloadControl({ action, onAction, disabled, progress, message, note }: Props) {
  const { label, Icon } = ACTIONS[action];
  const secondary = action === 'cancel' || action === 'pause';
  return <div className="file-download-control">
    {progress && <div className="file-download-progress">
      <div className="file-download-progress-heading">
        <span>{t(progress.status)}</span><strong>{progress.percent === undefined ? '—' : `${progress.percent}%`}</strong>
      </div>
      <progress max={100} value={progress.percent} aria-label={t('下载进度')} />
      {progress.detail && <p className="file-download-detail">{progress.detail}</p>}
    </div>}
    <div className="file-download-actions">
      <button type="button" className={`file-download-action${secondary ? ' is-secondary' : ''}`}
        disabled={disabled} onClick={onAction}><Icon size={16} aria-hidden="true" />{t(label)}</button>
    </div>
    {message && <p role="status" className="file-download-message">{t(message)}</p>}
    {note && <p className="file-download-note">{t(note)}</p>}
  </div>;
}
