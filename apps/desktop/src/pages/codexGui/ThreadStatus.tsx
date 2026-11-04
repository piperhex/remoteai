import { uiText } from "../../../../../shared/localization/uiText";
import { CircleAlert, LoaderCircle } from "lucide-react";
import styles from "./ThreadStatus.module.less";

export function ThreadStatus({ running, unread, needsInput }: {
  running: boolean; unread: boolean; needsInput: boolean;
}) {
  let indicator = unread ? <span className={styles.dot} aria-label={uiText("client.chat.unreadReply")} /> : null;
  if (needsInput) indicator = <CircleAlert size={14} className={styles.attention} aria-label={uiText("client.chat.finishing")} />;
  if (running) indicator = <LoaderCircle size={14} className={styles.spinner} aria-label={uiText("client.chat.replying")} />;
  return <span className={styles.status}>{indicator}</span>;
}
