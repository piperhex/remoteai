import { RotateCcw } from 'lucide-react';
import { useTurnRetry } from '../../../../../shared/chat/TurnRetryContext';
import { uiText } from "../../../../../shared/localization/uiText";
import styles from '../../../../../shared/conversation/RequestErrorNotice.module.less';

export function TurnRetryButton({ turnId }: { turnId: string }) {
  const action = useTurnRetry(turnId);
  if (!action) return null;
  return <button type="button" className={styles.retryButton} disabled={action.disabled}
    onClick={event => {
      // Retrying must not toggle the enclosing error details.
      event.preventDefault();
      event.stopPropagation();
      void action.retry();
    }}>
    <RotateCcw size={14} aria-hidden="true" />{action.pending ? uiText("client.chat.retrying") : uiText("client.terminal.retry")}
  </button>;
}
