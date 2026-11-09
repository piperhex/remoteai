import { uiText } from "../../../../../shared/localization/uiText";
import { Blocks, File, Folder, GitBranch, MessageSquare, Terminal, X } from "lucide-react";
import { attachmentKey, type AttachmentReference } from "../../../../../shared/conversation/attachmentTypes";
import { isDesktopApp } from "../../api/backend";
import { ComposerFileImage } from "./ComposerFileImage";
import imageStyles from "./ImageAttachments.module.less";
import styles from "./ComposerExtras.module.less";
import { ComposerAttachment } from '../../../../../shared/chat/ComposerAttachment';
import { AttachmentMetadataProvider } from './AttachmentMetadataProvider';

const referencePrefix = { file: "", folder: "", plugin: "", conversation: "@", coze: "#", ssh: '!' } as const;

function isImage(item: AttachmentReference) {
  return isDesktopApp && item.kind === "file" && /\.(png|jpe?g|webp|gif)$/i.test(item.path);
}

export function ComposerReferences({ items, disabled, active = true, onRemove }: {
  items: AttachmentReference[]; disabled: boolean; active?: boolean; onRemove: (path: string) => void;
}) {
  if (!items.length) return null;
  const images = items.filter(isImage);
  const references = items.filter((item) => !isImage(item));
  return <AttachmentMetadataProvider>
    {images.length > 0 && <div className={imageStyles.attachments} aria-label={uiText("client.composer.localImageAttachments")}>
      {images.map((item) => <ComposerFileImage key={item.path} item={item} images={images} disabled={disabled}
        active={active} onRemove={onRemove} />)}
    </div>}
    {references.length > 0 && <div className={styles.references} aria-label={uiText("client.composer.filePluginAndConversationReferences")}>
      {references.map((item) => {
        if (item.kind === 'file' || item.kind === 'folder') return <ComposerAttachment key={attachmentKey(item)}
          file={{ ...item, kind: item.kind }} t={uiText} active={active} disabled={disabled}
          onRemove={() => onRemove(attachmentKey(item))} />;
        const Icon = { plugin: Blocks, folder: Folder, file: File, conversation: MessageSquare,
          coze: GitBranch, ssh: Terminal }[item.kind];
        return <span className={styles.reference} key={attachmentKey(item)}>
          <Icon size={15} aria-hidden="true" /><span>{referencePrefix[item.kind]}{item.name}</span>
          <button type="button" disabled={disabled} aria-label={uiText("client.composer.removeAttachment", { value1: item.name })}
            onClick={() => onRemove(attachmentKey(item))}><X size={13} /></button>
        </span>;
      })}
    </div>}
  </AttachmentMetadataProvider>;
}
