import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useState } from "react";
import type { Turn } from "../../../../../shared/conversation/types";
import { formatTurnDuration, SECOND_MS, turnElapsedMs } from "../../../../../shared/conversation/turnTiming";
import styles from "../../../../../shared/conversation/styles.module.less";

export function TurnDuration({ turn, running, active, fallback, inline = false }: {
  turn: Turn; running: boolean; active: boolean; fallback?: string; inline?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running || !active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [turn.id, running, active]);
  const elapsed = turnElapsedMs(turn, now);
  const Element = inline ? "span" : "div";
  if (turn.status === "interrupted") return <Element className={styles.turnDuration}>
    {uiText("client.chat.generationStopped")}{elapsed != null && uiText("client.chat.duration.fdf64e", { value1: formatTurnDuration(elapsed) })}
  </Element>;
  if (elapsed == null || (turn.status === "inProgress" && !running)) return fallback ? <span>{fallback}</span> : null;
  return <Element className={styles.turnDuration}>
    {running ? uiText("client.chat.workingFor") : uiText("client.chat.duration.8d6d31")} {formatTurnDuration(elapsed)}
  </Element>;
}
