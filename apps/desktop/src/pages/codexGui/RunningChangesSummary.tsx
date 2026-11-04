import { uiText } from "../../../../../shared/localization/uiText";
import { useGuiLanguage } from '../../../../../shared/localization/useGuiLanguage';
import { useId, useMemo } from "react";
import { ChevronRight, FileText } from "lucide-react";
import { useDetailsEntry } from "../../../../../shared/conversation/detailsContext";
import { useTurnChangedFiles } from "../../../../../shared/conversation/useTurnChangedFiles";
import { summarizeDiffFiles } from "../../../../../shared/chat/diffSummary";
import type { Conversation, Turn } from "../../../../../shared/conversation/types";
import styles from "./RunningChangesSummary.module.less";

function TurnChangesBadge({ turn }: { turn: Turn }) {
  useGuiLanguage();
  const id = useId();
  const files = useTurnChangedFiles(turn);
  const title = uiText("client.chat.changesThisTurn");
  const entry = useMemo(() => ({ id, title, files }), [id, files, title]);
  const panel = useDetailsEntry(entry);
  if (!files.length) return null;
  const { files: summary, added, removed } = summarizeDiffFiles(files);
  const count = summary.length;
  return <div className={styles.wrap}>
    <button type="button" className={styles.badge} onClick={() => panel?.open(entry)}
      aria-label={uiText("client.conversation.viewChangesThisTurnFilesEditedLinesAddedLinesRemoved", { value1: count, value2: added, value3: removed })}>
      <FileText size={15} aria-hidden="true" />
      <span>{uiText("client.chat.edited")} {count} {uiText("client.chat.files.2d4a2a")}</span>
      <span className={styles.counts}>
        <span className={styles.added}>+{added}</span><span className={styles.removed}>−{removed}</span>
      </span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  </div>;
}

export function RunningChangesSummary({ value }: { value?: Conversation }) {
  const turn = value?.turns.find((entry) => entry.id === value.activeTurn);
  return turn ? <TurnChangesBadge key={`${value?.thread.id}:${turn.id}`} turn={turn} /> : null;
}
