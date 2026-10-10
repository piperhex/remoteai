import { Popover, Tooltip } from "antd";
import { ChevronRight, Info } from "lucide-react";
import type { Language } from "../../i18n";
import type { UsageWindow } from "../../types";
import { remainingTone, resetCountdownWithDays, resetLabel } from "../../utils/format";
import { accountCardLabels } from "./accountCardLabels";

interface AccountUsageCardProps {
  usage?: UsageWindow | null;
  label: string;
  language: Language;
  now: number;
}

export function AccountUsageCard({ usage, label, language, now }: AccountUsageCardProps) {
  const text = accountCardLabels(language);
  const remaining = usage && Number.isFinite(usage.remainingPercent)
    ? Math.round(Math.min(100, Math.max(0, usage.remainingPercent))) : null;
  const countdown = remaining !== null ? resetCountdownWithDays(usage?.resetsAt, language, now) : null;
  const reset = remaining !== null ? resetLabel(usage?.resetsAt, language, "oneWeek") : text.noData;
  const tone = remaining === null ? "missing" : remainingTone(remaining);
  return <div className={`card-usage-meter ${tone}`}>
    <div className="card-usage-head">
      <span className="card-usage-label">{label}
        <Tooltip title={text.hint} styles={{ root: { maxWidth: 400 } }}>
          <button type="button" className="card-usage-info" aria-label={`${label}: ${text.hint}`}>
            <Info size={13} aria-hidden="true" />
          </button>
        </Tooltip>
      </span>
      <strong className="card-usage-value">{remaining === null ? "--" : `${remaining}%`}</strong>
      {countdown && <span className="card-usage-countdown">{text.countdown.replace("{time}", countdown)}</span>}
      <Popover trigger="click" placement="bottomRight" styles={{ root: { maxWidth: 400 } }}
        title={label} content={<div className="card-usage-details" onClick={(event) => event.stopPropagation()}>
          {remaining !== null && <>
            <span>{text.remaining}: {remaining}%</span>
            <span>{text.used}: {100 - remaining}%</span>
          </>}
          <span>{reset}</span>
        </div>}>
        <button type="button" className="card-usage-details-button" aria-label={`${label}: ${text.details}`}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </Popover>
    </div>
    <div className="card-usage-track" role={remaining === null ? undefined : "progressbar"}
      aria-label={`${label}: ${text.remaining}`} aria-valuemin={remaining === null ? undefined : 0}
      aria-valuemax={remaining === null ? undefined : 100}
      aria-valuenow={remaining ?? undefined}>
      <span style={{ width: `${remaining ?? 0}%` }} />
    </div>
    <span className="card-usage-reset">{reset}</span>
  </div>;
}
