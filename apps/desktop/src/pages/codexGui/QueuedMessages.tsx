import { guiText } from "../../i18n/guiText";
import { Button, Dropdown } from "antd";
import { ArrowDown, ArrowUp, CornerDownRight, MoreHorizontal, Trash2 } from "lucide-react";
import type { QueuedMessage } from "./types";
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
      <span className={styles.text}>{item.text || item.attachments?.map((item) => item.name).join("、") || guiText("图片消息")}
        {item.images.length > 0 && <small> · {item.images.length}  {guiText("张图片")}</small>}
        {Boolean(item.attachments?.length) && <small> · {item.attachments?.length}  {guiText("个附件")}</small>}</span>
      <Button type="text" size="small" aria-label={guiText("上移待发送消息")} title={guiText("上移")} icon={<ArrowUp size={14} />}
        disabled={!canMoveUp} onClick={() => queue.move(threadId, item.id, "up")} />
      <Button type="text" size="small" aria-label={guiText("下移待发送消息")} title={guiText("下移")} icon={<ArrowDown size={14} />}
        disabled={!canMoveDown} onClick={() => queue.move(threadId, item.id, "down")} />
      <Button type="text" size="small" disabled={!running || !connected || item.busy}
        onClick={() => void queue.steer(threadId, item.id)}>{guiText("调整方向")}</Button>
      <Button type="text" size="small" aria-label={guiText("删除待发送消息")} icon={<Trash2 size={14} />}
        disabled={item.busy} onClick={() => queue.remove(threadId, item.id)} />
      <Dropdown trigger={["click"]} menu={{ items: [{ key: "edit", label: guiText("编辑") }],
        onClick: () => onEdit(item.id) }} overlayStyle={{ maxWidth: 400 }}>
        <Button type="text" size="small" aria-label={guiText("待发送消息选项")} icon={<MoreHorizontal size={16} />}
          disabled={item.busy || editDisabled} />
      </Dropdown>
    </div>
    {item.error && <div role="status" style={{ maxWidth: 400, whiteSpace: 'normal' }}>{item.error}</div>}
  </li>;
}

export function QueuedMessages({ messages, ...context }: QueueProps) {
  if (!messages.length) return null;
  return <div className={styles.queue}>
    <div className={styles.heading}>{guiText("待发送 ·")} {messages.length}
      {!context.running && <Button type="text" size="small"
        disabled={!context.connected || messages.some((item) => item.busy)}
        onClick={() => void context.queue.flush(context.threadId, true)}>{guiText("发送全部")}</Button>}</div>
    <ul aria-label={guiText("待发送消息")}>{messages.map((item, index) =>
      <QueueItem key={item.id} item={item} context={context}
        canMoveUp={!item.busy && index > 0 && !messages[index - 1].busy}
        canMoveDown={!item.busy && index < messages.length - 1 && !messages[index + 1].busy} />)}</ul>
  </div>;
}
