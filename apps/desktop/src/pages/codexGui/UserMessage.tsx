import { guiLocale, uiText } from "../../../../../shared/localization/uiText";
import { useState } from "react";
import { Button } from "antd";
import { Pencil } from "lucide-react";
import type { Item } from "../../../../../shared/conversation/types";
import { visibleUserContent } from "../../../../../shared/chat/conversationContext";
import { UserMessageEditor } from "./UserMessageEditor";
import { CopyButton } from "../../../../../shared/conversation/CopyButton";
import { MessageImage } from "../../../../../shared/conversation/MessageImage";
import { MessageQuotes } from "./MessageQuotes";
import { quotedMessage } from "../../../../../shared/chat/quotedMessage";
import { FileMenu } from "../../../../../shared/conversation/FileMenu";
import { messageAttachments } from "../../../../../shared/chat/messageAttachments";
import { MessageAttachments } from "../../../../../shared/chat/SentMessageAttachments";
import { AttachmentMetadataProvider } from './AttachmentMetadataProvider';
import { CONVERSATION_PREFIX } from "../../../../../shared/conversation/conversationReferences";
import { isMessageImage, type SubmitMessageEdit } from "../../../../../shared/conversation/messageEditContent";
import userStyles from "./UserMessage.module.less";
import styles from "../../../../../shared/conversation/styles.module.less";

const MILLISECONDS_PER_SECOND = 1000;
function referenceLabel(path?: string) {
  if (path?.startsWith("coze://")) return "Coze";
  if (path?.startsWith(CONVERSATION_PREFIX)) return uiText("client.workspaceActions.referenceAConversation");
  if (path?.startsWith("plugin://")) return uiText("client.chat.plugins");
  return uiText("client.mobile.attachments");
}
const sentAtOptions: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
};

export function UserMessage({ item, startedAt, onEdit, onDelete, editDisabled = false }: {
  item: Item; startedAt?: number | null; onEdit?: SubmitMessageEdit; editDisabled?: boolean;
  onDelete?: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const parts = visibleUserContent(item.content ?? (item.text ? [item.text] : []));
  const images = parts.filter(isMessageImage);
  const mentions = parts.filter((part) => part.type === "mention");
  const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const message = quotedMessage(text);
  const files = messageAttachments(message.text, mentions);
  const date = startedAt == null ? null : new Date(startedAt * MILLISECONDS_PER_SECOND);
  const sentAt = date && Number.isFinite(date.getTime()) ? date : null;
  const showBubble = editing || Boolean(message.text || message.quotes.length || mentions.length);
  if (!showBubble && !images.length) return null;
  return <article className={`${styles.userMessage} ${editing ? userStyles.editingMessage : ""}`}>
    {!editing && images.length > 0 && <div className={userStyles.attachments}>
      {images.map((part, index) =>
        <MessageImage key={index} src={part.url || part.path} alt={uiText("client.conversation.imageAttachment", { value1: index + 1 })} />)}
    </div>}
    {showBubble && <div className={`${styles.userBubble} ${userStyles.bubble}`}>
      {files.references.map((part, index) =>
        <span className={styles.imageLabel} key={`reference-${index}`}>
          {referenceLabel(part.path)}：{part.name || part.path}
        </span>)}
      {editing && onEdit ? <UserMessageEditor text={text} images={images}
        skills={parts.flatMap((part) => part.type === "skill" && part.path
          ? [{ name: part.name ?? "", path: part.path }] : [])}
        disabled={editDisabled} onSubmit={onEdit} onDelete={onDelete}
        onCancel={() => setEditing(false)} /> : <>
        <MessageQuotes key={text} quotes={message.quotes} />
        <AttachmentMetadataProvider><MessageAttachments key={`files-${text}`} attachments={files.attachments} t={uiText}
          renderFile={file => <FileMenu path={file.path} preview>{file.name}</FileMenu>} /></AttachmentMetadataProvider>
        {files.text && <div>{files.text}</div>}
      </>}
    </div>}
    {!editing && <div className={styles.userMessageActions}>
      {sentAt && <time dateTime={sentAt.toISOString()} title={sentAt.toLocaleString(guiLocale())}>
        {new Intl.DateTimeFormat(guiLocale(), sentAtOptions).format(sentAt)}
      </time>}
      <CopyButton text={text} />
      {onEdit && !editing && <Button type="text" size="small" aria-label={uiText("client.workspaceActions.editMessage")} disabled={editDisabled}
        icon={<Pencil size={14} />} onClick={() => setEditing(true)} />}
    </div>}
  </article>;
}
