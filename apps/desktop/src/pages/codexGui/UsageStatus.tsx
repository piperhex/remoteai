import { guiText } from "../../i18n/guiText";
import { useEffect, useState } from "react";
import { Tooltip } from "antd";
import { useUsageStatus } from "./useUsageStatus";
import { ContextUsageButton } from "./ContextUsageButton";
import { ContextSettingsDialog } from "./ContextSettingsDialog";
import type { ThreadTokenUsage } from "./types";
import styles from "./UsageStatus.module.less";
import { formatTokens, usageTrailing } from "../../../../../shared/remote-chat/usage";
import { useTokenCostDisplaySettings } from "../../hooks/useTokenCostDisplaySettings";
import { formatEstimatedCost } from "../../utils/tokenCost";

const TOKEN_FRACTION_DIGITS = 2;
const TOOLTIP_STYLES = {
  root: { maxWidth: 400 },
  body: { fontSize: 12, lineHeight: "18px", padding: "6px 8px", overflowWrap: "anywhere" },
} as const;
type UsageHint = "context" | "tokens" | "cost" | "remaining";

function tooltipStyles(open: boolean) {
  // Closing animations must not overlap the next hovered or focused value's tooltip.
  return { ...TOOLTIP_STYLES, root: { ...TOOLTIP_STYLES.root, visibility: open ? "visible" : "hidden" } } as const;
}

function UsageValue({ text, description, className, open, onOpenChange }: {
  text: string; description: string; className: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  return <Tooltip title={description} fresh trigger={["hover", "focus"]} styles={tooltipStyles(open)}
    mouseLeaveDelay={0} open={open} onOpenChange={onOpenChange}>
    <strong className={`${styles.value} ${className}`} tabIndex={0}>{text}</strong>
  </Tooltip>;
}
export function UsageStatus({ active, threadId, tokenUsage }: {
  active: boolean; threadId?: string | null; tokenUsage?: ThreadTokenUsage;
}) {
  const { usage, error } = useUsageStatus(active);
  const display = useTokenCostDisplaySettings();
  const formatCost = (value: number) => formatEstimatedCost(value, display);
  const [hint, setHint] = useState<UsageHint | null>(null);
  const [settingsThread, setSettingsThread] = useState<string | null>(null);
  const trailing = usageTrailing(usage, guiText, formatCost);
  const tokens = usage ? formatTokens(usage.totalTokens, TOKEN_FRACTION_DIGITS) : "—";
  const pendingDescription = error || guiText("正在读取今日用量…");
  useEffect(() => {
    if (!active || (hint === "remaining" && !trailing)) setHint(null);
  }, [active, hint, trailing]);
  useEffect(() => { setHint(null); }, [threadId]);
  useEffect(() => { setSettingsThread(null); }, [threadId, active]);
  const changeHint = (key: UsageHint, open: boolean) => {
    setHint((current) => {
      if (open) return key;
      return current === key ? null : current;
    });
  };
  return <div className={styles.status} onKeyDown={(event) => {
    if (event.key === "Escape" && hint) { event.stopPropagation(); setHint(null); }
  }}>
    <span className={styles.usage} role="group" aria-label={guiText("今日用量")}>
      <ContextUsageButton threadId={threadId} usage={tokenUsage} open={active && hint === "context"}
        onSettings={threadId ? () => { setHint(null); setSettingsThread(threadId); } : undefined}
        onOpenChange={(open) => changeHint("context", open)} />
      <span>{guiText("今日")}</span>
      <UsageValue className={styles.tokens} text={tokens}
        open={active && hint === "tokens"} onOpenChange={(open) => changeHint("tokens", open)}
        description={usage ? guiText("今日 Token 用量：{value1}", { value1: tokens }) : pendingDescription} />
      <span>·</span>
      <UsageValue className={styles.cost} text={usage ? formatCost(usage.estimatedCostUsd) : "—"}
        open={active && hint === "cost"} onOpenChange={(open) => changeHint("cost", open)}
        description={usage ? guiText("今日预估费用：{value1}", { value1: formatCost(usage.estimatedCostUsd) }) : pendingDescription} />
      {trailing && <><span>·</span>
        <UsageValue className={styles[trailing.tone]} text={trailing.text} description={trailing.description}
          open={active && hint === "remaining"} onOpenChange={(open) => changeHint("remaining", open)} />
      </>}
    </span>
    {active && settingsThread && settingsThread === threadId && <ContextSettingsDialog key={settingsThread}
      threadId={settingsThread} onClose={() => setSettingsThread(null)} />}
  </div>;
}
