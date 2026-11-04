import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatRemoteError } from "../../../../shared/localization/errors";
import { syncCodexNotification } from "../api/backend";
import { recordToastLog } from "../api/errorLogs";
import { guiLanguage } from "../../../../shared/localization/uiText";
import { useGuiLanguage } from "../../../../shared/localization/useGuiLanguage";

/**
 * Toasts receive app copy that is already translated as well as raw backend messages. The error
 * log keeps the raw text; what the user sees goes through the backend dictionary, which leaves
 * translated text unchanged.
 */
export function useToast() {
  const language = useGuiLanguage();
  const [rawMessage, setRawMessage] = useState<string | null>(null);
  const timer = useRef<number>();

  const notify = useCallback((nextMessage: string) => {
    void recordToastLog(nextMessage).catch(() => {
      console.debug("The notification could not be added to the error log.");
    });
    window.clearTimeout(timer.current);
    setRawMessage(nextMessage);
    timer.current = window.setTimeout(() => setRawMessage(null), 3400);
    void syncCodexNotification(formatRemoteError(guiLanguage(), nextMessage)).catch(() => {
      console.debug("Codex notification mirror is unavailable.");
    });
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  const message = useMemo(
    () => (rawMessage === null ? null : formatRemoteError(language, rawMessage)),
    [language, rawMessage],
  );
  return { message, notify };
}
