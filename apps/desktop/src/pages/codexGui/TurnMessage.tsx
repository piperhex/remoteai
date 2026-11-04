import { uiText } from "../../../../../shared/localization/uiText";
import { useGuiLanguage } from '../../../../../shared/localization/useGuiLanguage';
import { Fragment, memo, useMemo } from "react";
import { useCommittedCallback } from '../../../../../shared/chat/useCommittedCallback';
import type { Item, Turn } from "../../../../../shared/conversation/types";
import type { SubmitMessageEdit } from "../../../../../shared/conversation/messageEditContent";
import { MessageItem } from "./MessageItem";
import { TurnDuration } from "./TurnDuration";
import { TurnPlan } from "./TurnPlan";
import { TurnDiff } from "./TurnDiff";
import { useTurnChangedFiles } from "../../../../../shared/conversation/useTurnChangedFiles";
import styles from "../../../../../shared/conversation/styles.module.less";
import { GeneratedImages } from "./GeneratedImages";
import { RequestErrorNotice } from "./RequestErrorNotice";
import type { CapacityRetryControl } from "../../../../../shared/conversation/CapacityErrorNotice";
import { turnRequestErrors } from "../../../../../shared/conversation/turnRequestErrors";
import { isModelCapacityError } from "../../../../../shared/conversation/requestError";
import { TurnProcess } from "./TurnProcess";
import type { TurnMessageGroup } from "./turnMessageGroups";
import { groupVisibleTurns } from "./messageErrorGroups";
export { groupTurnItems } from "../../../../../shared/chat/turnGroups";

export const TurnMessage = memo(function TurnMessage({ turn, running, active, followsInterruption = false,
  editableItemId, onEdit, onDelete, editDisabled, threadId, visibleItems = turn.items, onFork, forkDisabled,
  retry, onCancelRetry, messageGroups }: {
  turn: Turn; running: boolean; active: boolean; followsInterruption?: boolean;
  editableItemId?: string; onEdit?: SubmitMessageEdit; editDisabled?: boolean;
  onDelete?: () => Promise<boolean>;
  threadId?: string;
  visibleItems?: Item[];
  messageGroups?: TurnMessageGroup[];
  onFork?: () => void; forkDisabled?: boolean;
} & CapacityRetryControl) {
  useGuiLanguage();
  const fork = useCommittedCallback(() => onFork?.());
  const edit = useCommittedCallback<Parameters<SubmitMessageEdit>, ReturnType<SubmitMessageEdit>>(
    content => onEdit ? onEdit(content) : Promise.resolve(false));
  const remove = useCommittedCallback(() => onDelete ? onDelete() : Promise.resolve(false));
  const groups = useMemo(() => messageGroups ?? groupVisibleTurns([
    { turn, items: visibleItems, followsInterruption },
  ])[0].groups, [turn, followsInterruption, visibleItems, messageGroups]);
  const files = useTurnChangedFiles(turn);
  const showChanges = !running && turn.status !== "inProgress" && files.length > 0;
  const responseIndex = groups.findIndex((group) => group.type !== "error" && group.items[0].type !== "userMessage");
  const showDuration = responseIndex === -1
    && (!turnRequestErrors(turn).length || groups.some((group) => group.type === "error"));
  return <div className={styles.turn} data-turn-id={turn.id}>
    {groups.map((group, index) => group.type === "error"
      ? <RequestErrorNotice key={group.key} turn={turn} record={group.error} count={group.count}
        retry={group.error.id === turnRequestErrors(turn).at(-1)?.id ? retry : undefined}
        onCancelRetry={onCancelRetry} />
      : <Fragment key={group.key}>
      {index === responseIndex && group.type !== "work"
        && <TurnDuration turn={turn} running={running} active={active} />}
      {group.type === "work" ? <TurnProcess turn={turn} items={group.items} running={running}
        active={active} timed={index === responseIndex} />
        : <div className={styles.messageEntry} data-message-id={group.items[0].id}>
        <MessageItem item={group.items[0]} startedAt={turn.startedAt}
        completedAt={turn.completedAt} onFork={onFork ? fork : undefined}
        forkDisabled={forkDisabled || running || turn.status === "inProgress"}
        onEdit={onEdit && group.items[0].id === editableItemId ? edit : undefined} editDisabled={editDisabled}
        onDelete={onDelete && group.items[0].id === editableItemId ? remove : undefined}
        streaming={running && group.items[0].status !== "completed"} /></div>}
    </Fragment>)}
    {showDuration && !running && !isModelCapacityError(turn.error)
      && <TurnDuration turn={turn} running={running} active={active} />}
    <GeneratedImages items={visibleItems} />
    <TurnPlan turn={turn} />
    {showChanges && <TurnDiff files={files} title={turn.diff ? uiText("client.chat.changesThisTurn") : uiText("client.chat.fileChanges")}
      threadId={threadId} turnId={turn.id}
      disabled={running || turn.status === "inProgress" || Boolean(editDisabled)} />}
  </div>;
});
