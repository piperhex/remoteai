import { guiText } from "../../i18n/guiText";
import { CircleAlert, X } from "lucide-react";
import type { ReactNode } from 'react';
import type { CapacityRetryState } from "./capacityRetry";
import { MODEL_CAPACITY_MESSAGE } from "./requestError";
import styles from "./RequestErrorNotice.module.less";

export interface CapacityRetryControl {
  retry?: CapacityRetryState;
  onCancelRetry?: () => void;
}

export function CapacityErrorNotice({ retry, onCancelRetry, action }: CapacityRetryControl & { action?: ReactNode }) {
  return <div className={styles.capacityNotice}>
    <div className={styles.capacityContent}>
      <CircleAlert size={20} aria-hidden="true" />
      <span className={styles.capacityMessage}>{MODEL_CAPACITY_MESSAGE}</span>
    </div>
    {action}
    {retry && <div className={styles.countdown}>
      <span role="status">{retry.seconds > 0 ? guiText("{value1} 秒后自动重试", { value1: retry.seconds }) : guiText("等待重试…")}</span>
      <button type="button" aria-label={guiText("停止自动重试")} onClick={onCancelRetry}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>}
  </div>;
}
