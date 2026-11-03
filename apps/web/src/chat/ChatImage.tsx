import { displayText } from '../i18n/index';
import { ViewportContent } from '../../../../shared/chat/ViewportContent';
import { t, useLanguage } from '../i18n';
import { createContext, useContext, useState } from 'react';
import { useChatImage, type ImagePreviewOptions } from '../../../../shared/remote-chat/client/useChatImage';
import { ImageViewer } from '../../../../shared/chat/ImageViewer';
import { downloadChatImage } from './downloadImage';
import { FileEnvironmentContext } from '../../../desktop/src/pages/codexGui/fileEnvironment';
import { ImagePreview } from '../../../desktop/src/pages/codexGui/ImagePreview';
import { remoteImageBytes } from './remoteImageBytes';
import { useDesktopLayout } from '../useDesktopLayout';
import thumbnailStyles from '../../../../shared/chat/toolImageThumbnail.module.css';
import { ImageThumbnail } from '../../../../shared/chat/ImageThumbnail';
import { DetailsContext } from '../../../desktop/src/pages/codexGui/detailsContext';
import { ChatFileContext } from './ChatFileLink';
import { parseFileReference } from '../../../../shared/chat/fileReference';
import { chatBrowserResource } from './chatBrowserResource';
import { imageBrowserResource } from '../../../desktop/src/pages/codexGui/filePreview/imageResource';
import { useFileMenu } from '../../../desktop/src/pages/codexGui/useFileMenu';

export const ChatImageContext = createContext<ImagePreviewOptions | null>(null);

type ChatImageProps = { source?: string; description?: string; compact?: boolean };

export function ChatImage(props: ChatImageProps) {
  const desktop = useDesktopLayout();
  const environment = useContext(FileEnvironmentContext);
  const fixedImage = desktop || Boolean(environment);
  return <ViewportContent key={props.source} image fixedImage={fixedImage}>
    {() => <VisibleChatImage {...props} fixedImage={fixedImage} />}</ViewportContent>;
}

function VisibleChatImage({ source, description = t("client.chat.image"), compact, fixedImage }: {
  source?: string; description?: string; compact?: boolean; fixedImage: boolean;
}) {
  useLanguage();
  const environment = useContext(FileEnvironmentContext);
  const image = useChatImage(source, useContext(ChatImageContext));
  const [preview, setPreview] = useState(false);
  const panel = useContext(DetailsContext);
  const files = useContext(ChatFileContext);
  const file = source ? parseFileReference(source) : undefined;
  const menu = useFileMenu(file ?? { path: '' });
  const open = () => {
    if (!fixedImage || !panel?.openResource || !source) { setPreview(true); return; }
    if (file && environment) { void menu.preview(); return; }
    if (file && files) { panel.openResource(chatBrowserResource(file.path, files)); return; }
    panel.openResource(imageBrowserResource({ key: JSON.stringify([files?.threadId, source]),
      title: description, source, load: image.original }));
  };
  if (!fixedImage && image.failed) return <span className="chat-image-notice" role="status">
    {description}{t("client.chat.couldNotLoadImage")} <button type="button" className="chat-button" onClick={image.retry}>{t("client.terminal.retry")}</button>
  </span>;
  if (!fixedImage && (image.loading || !image.url)) {
    return <span className="chat-image-notice" role="status">{t("client.chat.loadingImage")}</span>;
  }
  return <>
    {fixedImage ? <ImageThumbnail key={image.key} url={image.url} description={description} failed={image.failed}
      translate={t} retry={image.retry} onError={image.fail} onPreview={open} className="chat-image" />
      : <button type="button" className={`chat-image${compact ? ` ${thumbnailStyles.thumbnail}` : ''}`}
      aria-label={t("client.chat.enlarge", { value1: description })} onClick={open}>
      <img key={image.key} src={image.url} alt={description} loading="lazy" decoding="async"
        referrerPolicy="no-referrer" onError={image.fail} />
    </button>}
    {preview && image.url && (environment ? <ImagePreview key={image.key} thumbnail={image.url} description={description}
      load={image.original} prepare={remoteImageBytes} download={image.save ?? downloadChatImage}
      close={() => setPreview(false)} /> : <ImageViewer key={image.key} thumbnail={image.url} description={description}
      inlineViewControls={fixedImage}
      translate={displayText} load={image.original} download={image.save ?? downloadChatImage} close={() => setPreview(false)} />)}
  </>;
}
