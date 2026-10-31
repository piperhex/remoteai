import { remoteErrorText } from '../localization/errors';
import { defaultText } from '../localization/messages';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Download, Image as ImageIcon, LoaderCircle } from 'lucide-react';
import { useImageViewer } from './useImageViewer';
import type { PreviewImageLoader } from '../remote-chat/previewProgress';
import { PreviewTransferProgress } from './PreviewTransferProgress';
import { ImageViewerFrame } from './ImageViewerFrame';
import { ImageAiToolbar } from './ImageAiToolbar';
import { useMobileImageViewer } from './useMobileImageViewer';

interface Props {
  thumbnail: string; description: string; load: PreviewImageLoader; close: () => void;
  download?: (url: string) => void | Promise<void>;
  contextMenu?: (event: MouseEvent, url: string) => void;
  feedback?: string;
  translate?: (text: string) => string;
  formatError?: (error: unknown) => string;
  autoLoadOriginal?: boolean;
  inlineViewControls?: boolean;
}

export function ImageViewer({ thumbnail, description, load, close, download, contextMenu, feedback,
  translate = defaultText, formatError = remoteErrorText, autoLoadOriginal = false,
  inlineViewControls = false }: Props) {
  const image = useImageViewer(load, autoLoadOriginal);
  const [downloadError, setDownloadError] = useState('');
  const [saving, setSaving] = useState(false);
  const mobile = useMobileImageViewer();
  const originalAction = !image.url && !image.loading && <button type="button"
    className={`cs-image-original${mobile ? ' cs-image-original-mobile' : ''}`} onClick={image.request}>
    <ImageIcon size={20} aria-hidden="true" />
    <span>{translate(image.error ? 'client.mobile.reloadOriginalImage' : 'client.chat.viewOriginal')}</span>
  </button>;
  const renderEditor = (viewControls?: ReactNode) => <ImageAiToolbar load={image.loadOriginal}
    close={close} translate={translate} viewControls={viewControls}
    originalAction={mobile ? undefined : originalAction} />;
  return <ImageViewerFrame src={image.url ?? thumbnail} description={description} close={close}
    renderToolbar={inlineViewControls ? renderEditor : undefined}
    translate={translate} onError={image.fail} onContextMenu={(event) => {
      if (!contextMenu) return;
      event.preventDefault();
      if (image.url && !image.error) contextMenu(event, image.url);
    }}>
    {mobile && originalAction}
    {download && <button type="button" className="cs-image-download" disabled={saving || image.loading}
      aria-label={translate(saving ? "client.projectBrowser.saving" : "client.shared.downloadImage")} aria-busy={saving}
      onClick={async () => {
        setSaving(true);
        setDownloadError('');
        try { await download(await image.loadOriginal()); }
        catch (error) { setDownloadError(error instanceof Error ? error.message : '下载失败，请重试。'); }
        finally { setSaving(false); }
      }}>{saving ? <LoaderCircle size={24} className="cs-image-download-spinner" aria-hidden="true" />
        : <Download size={24} aria-hidden="true" />}
      <span>{translate(saving ? "client.projectBrowser.saving" : "client.shared.downloadImage")}</span></button>}
    {!inlineViewControls && renderEditor()}
    {image.loading && <div className="cs-image-status cs-image-transfer">
      <PreviewTransferProgress progress={image.progress} label={translate("client.shared.loadingFullImage")} /></div>}
    {downloadError && <div className="cs-image-status" role="status">{formatError(downloadError)}</div>}
    {feedback && <div className="cs-image-status" role="status">{feedback}</div>}
    {image.error && <div className="cs-image-status" role="status">{translate("client.shared.couldNotLoadFullImage")}</div>}
  </ImageViewerFrame>;
}
