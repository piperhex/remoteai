import { uiText } from "../../../../../shared/localization/uiText";
import { useId } from "react";
import { Popover } from "antd";
import { Settings } from "lucide-react";
import { formatCompactTokenCount } from "../../../../../shared/context-usage/format";
import type { ThreadTokenUsage } from "../../../../../shared/conversation/types";
import { contextUsage, FULL_PERCENT } from "../../../../../shared/conversation/contextUsage";
import styles from "./ContextUsageButton.module.less";
import { ContextCapacityHint } from "./ContextCapacityHint";

export function ContextUsageButton({ usage, open, onOpenChange, onSettings, threadId }: {
  usage?: ThreadTokenUsage; open: boolean; onOpenChange: (open: boolean) => void;
  onSettings?: () => void;
  threadId?: string | null;
}) {
  const id = useId();
  const context = contextUsage(usage);
  const percent = context?.percent;
  const content = <div id={id} className={styles.content}>
    <div className={styles.heading}><span>{uiText("client.chat.contextWindow")}</span>
      <button type="button" className={styles.button} aria-label={uiText("client.chat.setContextCapacityForThisChat")}
        disabled={!onSettings} onClick={onSettings}>
        <Settings size={14} aria-hidden="true" />
      </button>
    </div>
    {!onSettings && <div className={styles.hint}>{uiText("client.chat.selectAChatToSetItsCapacity")}</div>}
    {context ? <>
      <div>{percent != null ? uiText("client.composer.usedRemaining", { value1: percent, value2: FULL_PERCENT - percent }) : uiText("client.chat.contextCapacityUnknown")}</div>
      <div>{uiText("client.composer.used")} {formatCompactTokenCount(context.used, "zh")} Token
        {context.capacity !== null && uiText("client.composer.of", { value1: formatCompactTokenCount(context.capacity, "zh") })}</div>
    </> : <div>{uiText("client.shared.noContextUsageYet")}</div>}
    <ContextCapacityHint threadId={threadId} open={open} />
  </div>;
  return <Popover content={content} fresh trigger="click" placement="top" arrow={false}
    open={open} onOpenChange={onOpenChange}
    styles={{ root: { maxWidth: "min(400px, calc(100vw - 24px))", visibility: open ? "visible" : "hidden" },
      body: { padding: "6px 10px", borderRadius: 12 } }}>
    <button type="button" className={styles.button} aria-label={uiText("client.chat.viewContextUsage")} aria-expanded={open}
      aria-describedby={open ? id : undefined}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle className={styles.track} cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" pathLength={FULL_PERCENT}
          strokeDasharray={`${percent ?? 0} ${FULL_PERCENT}`} transform="rotate(-90 8 8)" />
      </svg>
    </button>
  </Popover>;
}
