import { t, useLanguage } from '../i18n';
import { useContext } from 'react';
import { useChatImage } from '../../../../shared/remote-chat/client/useChatImage';
import { ChatImageContext } from './ChatImage';
import { ImageViewer } from './ImageViewer';

/** File links open the same full-size viewer as message images, including cached offline originals. */
export function ChatImageFilePreview({ path, close }: { path: string; close: () => void }) {
  useLanguage();
  const image = useChatImage(path, useContext(ChatImageContext));
  const description = path.split(/[\\/]/).at(-1) || t("图片");
  return <ImageViewer key={image.key} thumbnail={image.url} description={description}
    load={image.original} save={image.save} close={close} />;
}
