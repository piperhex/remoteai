import { uiText } from "../../../../../shared/localization/uiText";
import { CircleAlert, ChevronDown } from "lucide-react";
import type { Turn } from "../../../../../shared/conversation/types";
import { isModelCapacityError, requestErrorDetails } from "../../../../../shared/conversation/requestError";
import { CapacityErrorNotice, type CapacityRetryControl } from "../../../../../shared/conversation/CapacityErrorNotice";
import { DeferredDetails } from "./DeferredDetails";
import { requestErrorPosition, turnRequestErrors, type TurnRequestError } from "../../../../../shared/conversation/turnRequestErrors";
import { TurnRetryButton } from "./TurnRetryButton";
import styles from "../../../../../shared/conversation/RequestErrorNotice.module.less";

function noticeMessage(turn: Turn, record: TurnRequestError): string {
  if (!record.willRetry) return uiText("client.chat.thisReplyStoppedBecauseOfAProblem");
  if (turn.status === "completed") return uiText("client.chat.theConnectionWasInterruptedAndHasRecovered");
  if (turn.status === "interrupted" || turn.status === "failed") return uiText("client.chat.theConnectionWasInterruptedDuringThisReply");
  const resumed = turn.items.slice(requestErrorPosition(turn, record))
    .some((item) => item.type !== "userMessage" && item.type !== "modelChange");
  if (resumed) return uiText("client.chat.theConnectionWasInterruptedAndHasRecovered");
  return uiText("client.chat.connectionInterruptedCodexIsRetrying");
}

export function RequestErrorNotice({ turn, record, count = 1, retry, onCancelRetry }: {
  turn: Turn; record: TurnRequestError; count?: number;
} & CapacityRetryControl) {
  const { error } = record;
  const action = !record.willRetry && record.id === turnRequestErrors(turn).at(-1)?.id
    ? <TurnRetryButton turnId={turn.id} /> : null;
  if (isModelCapacityError(error)) return <CapacityErrorNotice retry={retry} onCancelRetry={onCancelRetry}
    action={action} />;
  const details = error ? requestErrorDetails(error) : "";
  const message = noticeMessage(turn, record);
  if (!details) return <div className={styles.notice}><span role="status">{message}</span>{action}</div>;
  return <div className={styles.notice} data-request-error={record.id}>
    <DeferredDetails className={styles.errorRow} summary={
      <summary className={styles.summary} aria-label={uiText("client.chat.viewErrorDetails")}>
        <CircleAlert size={15} aria-hidden="true" />
        <span className={styles.preview} role="status">{message}</span>
        {count > 1 && <span className={styles.count}>×{count}</span>}
        <ChevronDown className={styles.toggle} size={15} aria-hidden="true" />
      </summary>}>
      {() => <div className={styles.details}><div>{message}</div><pre>{details}</pre></div>}
    </DeferredDetails>{action}
  </div>;
}
