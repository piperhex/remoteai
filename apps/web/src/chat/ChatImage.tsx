import { t, useLanguage } from '../i18n';
import { createContext, useContext, useState } from 'react';
import { useChatImage, type ImagePreviewOptions } from '../../../../shared/remote-chat/client/useChatImage';
import { ImageViewer } from '../../../../shared/chat/ImageViewer';
import { downloadChatImage } from './downloadImage';

export const ChatImageContext = createContext<ImagePreviewOptions | null>(null);

export function ChatImage({ source, description = t("图片") }: { source?: string; description?: string }) {
  useLanguage();
  const image = useChatImage(source, useContext(ChatImageContext));
  const [preview, setPreview] = useState(false);
  if (image.failed) return <span className="chat-image-notice" role="status">
    {description}{t("：图片加载失败")} <button type="button" className="chat-button" onClick={image.retry}>{t("重试")}</button>
  </span>;
  if (image.loading || !image.url) return <span className="chat-image-notice" role="status">{t("正在加载图片…")}</span>;
  return <>
    <button type="button" className="chat-image" aria-label={t("放大查看：{value1}", { value1: description })} onClick={() => setPreview(true)}>
      <img key={image.key} src={image.url} alt={description} loading="lazy" decoding="async"
        referrerPolicy="no-referrer" onError={image.fail} />
    </button>
    {preview && <ImageViewer key={image.key} thumbnail={image.url} description={description}
      translate={t} load={image.original} download={image.save ?? downloadChatImage} close={() => setPreview(false)} />}
  </>;
}
