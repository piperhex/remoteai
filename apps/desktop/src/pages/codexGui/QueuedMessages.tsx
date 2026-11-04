import { uiText } from "../../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../../shared/localization/errors";
import { Button, Dropdown } from "antd";
import { ArrowDown, ArrowUp, CornerDownRight, MoreHorizontal, Trash2 } from "lucide-react";
import type { QueuedMessage } from "../../../../../shared/conversation/types";
import type { MessageQueue } from "./messageQueue";
import styles from "./QueuedMessages.module.less";

interface QueueProps {
  threadId: string;
  messages: QueuedMessage[];
  running: boolean;
  connected: boolean;
  queue: MessageQueue;
  editDisabled: boolean;
  onEdit: (id: string) => void;
}

interface QueueItemProps {
  item: QueuedMessage;
  context: Omit<QueueProps, "messages">;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function QueueItem({ item, context, canMoveUp, canMoveDown }: QueueItemProps) {
  const { threadId, queue, running, connected, editDisabled, onEdit } = context;
  return <li className={styles.item}>
    <div className={styles.row}>
      <CornerDownRight size={15} />
      <span className={styles.text}>{item.text || item.attachments?.map((item) => item.name).join("、") || uiText("client.chat.imageMessage")}
        {item.images.length > 0 && <small> · {item.images.length}  {uiText("client.chat.images")}</small>}
        {Boolean(item.attachments?.length) && <small> · {item.attachments?.length}  {uiText("client.chat.attachments")}</small>}</span>
      <Button type="text" size="small" aria-label={uiText("client.chat.moveQueuedMessageUp")} title={uiText("client.conversation.moveUp")} icon={<ArrowUp size={14} />}
        disabled={!canMoveUp} onClick={() => queue.move(threadId, item.id, "up")} />
      <Button type="text" size="small" aria-label={uiText("client.chat.moveQueuedMessageDown")} title={uiText("client.conversation.moveDown")} icon={<ArrowDown size={14} />}
        disabled={!canMoveDown} onClick={() => queue.move(threadId, item.id, "down")} />
      <Button type="text" size="small" disabled={!running || !connected || item.busy}
        onClick={() => void queue.steer(threadId, item.id)}>{uiText("client.conversation.moveDirection")}</Button>
      <Button type="text" size="small" aria-label={uiText("client.chat.deleteQueuedMessage")} icon={<Trash2 size={14} />}
        disabled={item.busy} onClick={() => queue.remove(threadId, item.id)} />
      <Dropdown trigger={["click"]} menu={{ items: [{ key: "edit", label: uiText("client.chat.edit.051836") }],
        onClick: () => onEdit(item.id) }} overlayStyle={{ maxWidth: 400 }}>
        <Button type="text" size="small" aria-label={uiText("client.conversation.queuedMessageOptions")} icon={<MoreHorizontal size={16} />}
          disabled={item.busy || editDisabled} />
      </Dropdown>
    </div>
    {item.error && <div role="status" style={{ maxWidth: 400, whiteSpace: 'normal' }}>{remoteErrorText(item.error)}</div>}
  </li>;
}

export function QueuedMessages({ messages, ...context }: QueueProps) {
  if (!messages.length) return null;
  return <div className={styles.queue}>
    <div className={styles.heading}>{uiText("client.chat.queued")} {messages.length}
      {!context.running && <Button type="text" size="small"
        disabled={!context.connected || messages.some((item) => item.busy)}
        onClick={() => void context.queue.flush(context.threadId, true)}>{uiText("client.chat.sendAll")}</Button>}</div>
    <ul aria-label={uiText("client.chat.queuedMessages")}>{messages.map((item, index) =>
      <QueueItem key={item.id} item={item} context={context}
        canMoveUp={!item.busy && index > 0 && !messages[index - 1].busy}
        canMoveDown={!item.busy && index < messages.length - 1 && !messages[index + 1].busy} />)}</ul>
  </div>;
}
