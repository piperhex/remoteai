import { guiLocale, uiText } from "../../../../../shared/localization/uiText";
import { Button, Tooltip } from "antd";
import { Split } from "lucide-react";
import { CopyButton } from "../../../../../shared/conversation/CopyButton";
import { SECOND_MS } from "../../../../../shared/conversation/turnTiming";
import styles from "./MessageActions.module.less";

const timeOptions: Intl.DateTimeFormatOptions = {
  month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
};

export function MessageActions({ text, completedAt, onFork, forkDisabled }: {
  text: string; completedAt?: number | null; onFork?: () => void; forkDisabled?: boolean;
}) {
  const date = completedAt == null ? null : new Date(completedAt * SECOND_MS);
  const timestamp = date && Number.isFinite(date.getTime()) ? date : null;
  return <div className={styles.actions}>
    <CopyButton text={text} />
    <Tooltip title={uiText("client.conversation.branchIntoANewChat")} styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" size="small" aria-label={uiText("client.conversation.branchIntoANewChat")} disabled={!onFork || forkDisabled}
        icon={<Split size={14} />} onClick={onFork} />
    </Tooltip>
    {timestamp && <time className={styles.timestamp} dateTime={timestamp.toISOString()}>
      {new Intl.DateTimeFormat(guiLocale(), timeOptions).format(timestamp)}
    </time>}
  </div>;
}
