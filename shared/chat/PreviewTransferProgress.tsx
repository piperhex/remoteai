import type { PreviewProgress } from '../remote-chat/previewProgress';
import { previewProgressText } from './previewProgress';
import './previewTransferProgress.css';

export function PreviewTransferProgress({ progress, label }: { progress?: PreviewProgress; label: string }) {
  const text = previewProgressText(progress);
  return <div className="cs-preview-progress" role="status">
    <div className="cs-preview-progress-row"><span>{label}</span><strong>{text.percentage}</strong></div>
    <div className="cs-preview-progress-track" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={text.percent}
      aria-valuetext={`${text.percentage} · ${text.amount} · ${text.speed}`}>
      {text.percent !== undefined && <div className="cs-preview-progress-fill" style={{ width: `${text.percent}%` }} />}
    </div>
    <div className="cs-preview-progress-row cs-preview-progress-detail">
      <span>{text.amount}</span><span>{text.speed}</span>
    </div>
  </div>;
}
