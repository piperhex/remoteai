import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { invoke } from "../../api/backend";
import type { AttachmentReference } from "../../../../../shared/conversation/attachmentTypes";
import { ImagePreview } from "../../../../../shared/conversation/ImagePreview";
import { isInlineImage } from "../../../../../shared/conversation/imageSources";
import styles from "./ImageAttachments.module.less";
import { EMPTY_IMAGE, useImageGallery } from '../../../../../shared/chat/ImageGallery';

const RESOURCE_ERROR = "图片过大，暂时无法预览。请缩小尺寸后重试。";

function previewError(error: unknown) {
  const message = error instanceof Error ? error.message : error;
  return uiText(message === RESOURCE_ERROR ? "client.shared.thisImageIsTooLargeToPreviewResizeItAnd"
    : "client.shared.couldNotReadTheImagePleaseChooseItAgain");
}

async function loadImage(path: string, variant: "thumbnail" | "original") {
  const { url } = await invoke<{ url: string }>("codex_gui_attachment_preview", { request: { path, variant } });
  if (!isInlineImage(url)) throw new Error(uiText("client.composer.couldNotLoadImage"));
  return url;
}

export function ComposerFileImage({ item, images = [item], disabled, active, onRemove }: {
  item: AttachmentReference; disabled: boolean; active: boolean; onRemove: (path: string) => void;
  images?: AttachmentReference[];
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setUrl(undefined); setError("");
    void loadImage(item.path, "thumbnail").then(
      (url) => { if (!cancelled) setUrl(url); },
      (error: unknown) => { if (!cancelled) setError(previewError(error)); },
    );
    return () => { cancelled = true; };
  }, [item.path, attempt]);
  useEffect(() => { if (!active) setPreview(false); }, [active]);
  return <div className={styles.card}>
    {error && <span className={styles.status} role="status">{error}<button type="button"
      onClick={() => setAttempt((value) => value + 1)}>{uiText("client.terminal.retry")}</button>
    </span>}
    {!error && url && <button type="button" className={styles.thumbnail} aria-label={uiText("client.chat.enlarge", { value1: item.name })}
      onClick={() => setPreview(true)}>
      <img src={url} alt={item.name} onError={() => setError(previewError(undefined))} />
    </button>}
    {!error && !url && <span role="status">{uiText("client.composer.loading")}</span>}
    <button type="button" className={styles.remove} disabled={disabled} aria-label={uiText("client.composer.removeAttachment", { value1: item.name })}
      onClick={() => onRemove(item.path)}><X size={14} /></button>
    {active && preview && url && <ComposerImagePreview item={item} images={images} thumbnail={url}
      close={() => setPreview(false)} />}
  </div>;
}

function ComposerImagePreview({ item, images, thumbnail, close }: {
  item: AttachmentReference; images: AttachmentReference[]; thumbnail: string; close: () => void;
}) {
  const { current, navigation } = useImageGallery({ source: item.path, description: item.name },
    images.map(image => ({ source: image.path, description: image.name })));
  return <ImagePreview key={current.source} thumbnail={current.source === item.path ? thumbnail : EMPTY_IMAGE}
    description={current.description ?? item.name} navigation={navigation}
    load={() => loadImage(current.source, 'original')} close={close} />;
}
