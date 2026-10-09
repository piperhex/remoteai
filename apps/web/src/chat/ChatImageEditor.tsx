import { t, useLanguage } from '../i18n';
import { ImageEditor } from '../../../../shared/chat/ImageEditor';
import type { DraftImage } from '../../../../shared/remote-chat/attachments';
import './imageEditor.css';

export function ChatImageEditor({ image, save, close }: {
  image: DraftImage; save: (dataUrl: string) => void; close: () => void;
}) {
  const language = useLanguage();
  return <ImageEditor dataUrl={image.url} save={save} close={close} translate={t} language={language} />;
}
