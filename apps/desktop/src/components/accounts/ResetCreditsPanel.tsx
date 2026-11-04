import { Button } from "antd";
import { CalendarClock, RefreshCw } from "lucide-react";
import { formatRemoteError } from "../../../../../shared/localization/errors";
import type { Language, Translate } from "../../i18n";
import type { ResetCreditsLoadState } from "../../types";
import { formatSystemTime } from "../../../../../shared/accounts/format";

export function ResetCreditsPanel({ state, onRetry, language, t, missingState = "loading" }: {
  state?: ResetCreditsLoadState;
  onRetry: () => void;
  language: Language;
  t: Translate;
  missingState?: "loading" | "unknown";
}) {
  if (!state && missingState === "unknown") {
    return <div className="reset-credits-status">{t("table.resetCreditsUnknown")}</div>;
  }
  if (!state || state.status === "loading") {
    return <div className="reset-credits-status"><RefreshCw className="spin" size={16} />{t("reset.loading")}</div>;
  }
  if (state.status === "error") {
    return (
      <div className="reset-credits-status reset-credits-error">
        <span>{formatRemoteError(language, state.error)}</span>
        <Button size="small" icon={<RefreshCw size={13} />} onClick={onRetry}>{t("reset.retry")}</Button>
      </div>
    );
  }
  if (!state.data.credits.length) {
    return <div className="reset-credits-status">{t("reset.empty")}</div>;
  }
  return (
    <div className="reset-credits-panel">
      {state.data.credits.map((credit, index) => (
        <div className="reset-credit" key={`${credit.issuedAt ?? "unknown"}-${credit.expiresAt ?? "unknown"}-${index}`}>
          <div className="reset-credit-index"><CalendarClock size={16} />{t("reset.card", { index: index + 1 })}</div>
          <dl>
            <div><dt>{t("reset.issuedAt")}</dt><dd>{formatSystemTime(credit.issuedAt, language)} <span>{t("reset.timezone")}</span></dd></div>
            <div><dt>{t("reset.expiresAt")}</dt><dd>{formatSystemTime(credit.expiresAt, language)} <span>{t("reset.timezone")}</span></dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}
