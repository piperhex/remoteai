import inlineCopy from '@remoteai/i18n/copy/inline/desktop/components/FloatingUsageBubble/BubbleResetLabel';
import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useState } from "react";
import type { BubbleResetDisplay } from "../../types";
import type { Language } from "../../i18n";
import { resetClockTime } from "../../../../../shared/accounts/format";

export function BubbleResetLabel({ timestamp, language, display, className, compact = false }: {
  timestamp?: number | null;
  language: Language;
  display: BubbleResetDisplay;
  className?: string;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timestamp || display !== "countdown") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [display, timestamp]);

  if (display === "resetAt") {
    const clock = resetClockTime(timestamp);
    if (compact) {
      return (
        <small className={`floating-bubble-reset ${className ?? ""}`}>
          <span>{clock ?? ((language !== "zh" && language !== "en" ? uiText("client.usage.unknown", {}, language) : language === "zh" ? inlineCopy["text_4d8c1c5b"] : inlineCopy["unknown_b23a6a84"]))}</span>
        </small>
      );
    }
    return (
      <small className={`floating-bubble-reset floating-bubble-reset-stacked ${className ?? ""}`}>
        <span>{(language !== "zh" && language !== "en" ? (clock ? uiText("client.usage.resetsAt", {}, language) : uiText("client.usage.resetTime", {}, language)) : language === "zh" ? (clock ? inlineCopy["text_dd47b4d9"] : inlineCopy["text_f9063838"]) : (clock ? inlineCopy["Resets_at_7890153e"] : inlineCopy["Reset_time_1e6ca7f7"]))}</span>
        <span>{clock ?? ((language !== "zh" && language !== "en" ? uiText("client.usage.unknown", {}, language) : language === "zh" ? inlineCopy["text_4d8c1c5b"] : inlineCopy["unknown_b23a6a84"]))}</span>
      </small>
    );
  }

  const totalSeconds = timestamp ? Math.max(0, Math.ceil((timestamp * 1000 - now) / 1000)) : null;
  const days = totalSeconds === null ? null : Math.floor(totalSeconds / 86_400);
  const hours = totalSeconds === null ? null : Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = totalSeconds === null ? null : Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds === null ? null : totalSeconds % 60;
  const time = hours === null || minutes === null || seconds === null
    ? null
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (compact) {
    return (
      <small className={`floating-bubble-reset ${className ?? ""}`}>
        <span>{time ? `${days}${(language !== "zh" && language !== "en" ? uiText("client.mobile.d", {}, language) : language === "zh" ? inlineCopy["text_49da61ce"] : inlineCopy["d_18ac3e73"])}\u00a0${time}` : "--"}</span>
      </small>
    );
  }
  return (
    <small className={`floating-bubble-reset floating-bubble-reset-stacked ${className ?? ""}`}>
      {time ? <><span>{days}{(language !== "zh" && language !== "en" ? uiText("client.mobile.d", {}, language) : language === "zh" ? inlineCopy["text_49da61ce"] : inlineCopy["d_18ac3e73"])}</span><span>{time}</span></> : <span>--</span>}
    </small>
  );
}
