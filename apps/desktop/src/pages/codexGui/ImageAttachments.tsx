import { displayText } from '../../../../../shared/localization/uiText';
import { guiLanguage, uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { DraftImage } from "./useComposerDraft";
import { ImagePreview } from "../../../../../shared/conversation/ImagePreview";
import { ImageEditor } from "../../../../../shared/chat/ImageEditor";
import styles from "./ImageAttachments.module.less";

export function ImageAttachments({ images, disabled, active = true, onRemove, onEdit }: {
  images: DraftImage[]; disabled: boolean; active?: boolean; onRemove: (id: string) => void;
  onEdit: (id: string, url: string) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = images.find((image) => image.id === editingId);
  const preview = images.find((image) => image.id === previewId);
  const previewUrl = preview?.url;
  useEffect(() => { if (!active || !preview) setPreviewId(null); }, [active, preview]);
  useEffect(() => { if (!active || disabled || !editing) setEditingId(null); }, [active, disabled, editing]);
  if (!images.length) return null;
  return <><div className={styles.attachments} aria-label={uiText("client.conversation.imageAttachments")}>
    {images.map((image, index) => <div className={styles.card} key={image.id}>
      {image.url ? <button type="button" className={styles.thumbnail} aria-label={uiText("client.conversation.enlargeImage", { value1: index + 1 })}
        onClick={() => setPreviewId(image.id)}>
        <img src={image.url} alt={uiText("client.conversation.image", { value1: index + 1, value2: image.name })} />
      </button>
        : <span role="status">{uiText("client.composer.loading")}</span>}
      <button type="button" className={styles.remove} aria-label={uiText("client.chat.removeImage", { value1: index + 1 })}
        disabled={disabled} onClick={() => onRemove(image.id)}><X size={14} /></button>
      {image.url && <button type="button" className={styles.edit}
        aria-label={uiText("client.chat.annotateImage", { value1: index + 1 })}
        disabled={disabled} onClick={() => setEditingId(image.id)}>{uiText("client.chat.annotate")}</button>}
    </div>)}
  </div>
    {active && preview && previewUrl && <ImagePreview key={preview.id} thumbnail={previewUrl} description={preview.name}
      load={async () => previewUrl}
      close={() => setPreviewId(null)} />}
    {active && !disabled && editing?.url && <ImageEditor key={editing.id} dataUrl={editing.url}
      translate={displayText} language={guiLanguage()} mode="direct"
      save={(url) => onEdit(editing.id, url)} close={() => setEditingId(null)} />}
  </>;
}
