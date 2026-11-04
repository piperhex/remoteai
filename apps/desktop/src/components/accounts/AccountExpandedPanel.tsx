import { Button } from "antd";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Language, Translate } from "../../i18n";
import type { Account, ResetCreditsLoadState } from "../../types";
import { formatSystemTime } from "../../../../../shared/accounts/format";
import { AccountTotpPreview } from "./AccountTotpPreview";
import { ResetCreditsPanel } from "./ResetCreditsPanel";

const MASKED_VALUE = "••••••••";
const COPY_FEEDBACK_DURATION_MS = 1_600;

function detailValue(value: string, masked: boolean) {
  if (!value) return "-";
  return masked ? MASKED_VALUE : value;
}

function CopyableExpandedDetail({ value, masked, label, t }: {
  value: string;
  masked: boolean;
  label: string;
  t: Translate;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span>-</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    } catch {
      setCopied(false);
    }
  };

  const actionLabel = copied ? t("totp.copied") : label;
  return <span className="account-expanded-copy-value">
    <span>{masked ? MASKED_VALUE : value}</span>
    <button type="button" className={copied ? "copied" : undefined} onClick={() => void copy()}
      aria-label={actionLabel} title={actionLabel}>
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  </span>;
}

function AccountExpandedDetails({ account, privacyMode, hideAccountNotes, t }: {
  account: Account;
  privacyMode: boolean;
  hideAccountNotes: boolean;
  t: Translate;
}) {
  const note = detailValue(account.note, hideAccountNotes && Boolean(account.note));
  return <section className="account-details-section" aria-labelledby={`account-details-${account.id}`}>
    <h3 id={`account-details-${account.id}`}>{t("note.title")}</h3>
    <dl className="account-expanded-details-grid">
      <div><dt>{t("note.label")}</dt><dd>{note}</dd></div>
      <div><dt>{t("note.expirationDate")}</dt><dd>{detailValue(account.expiresAt, false)}</dd></div>
      <div><dt>{t("note.phoneNumber")}</dt>
        <dd><CopyableExpandedDetail value={account.privateDetails.phoneNumber} masked={privacyMode}
          label={t("note.copyPhoneNumber")} t={t} /></dd></div>
      <div><dt>{t("note.password")}</dt>
        <dd><CopyableExpandedDetail value={account.privateDetails.password} masked={privacyMode}
          label={t("note.copyPassword")} t={t} /></dd></div>
      <div><dt>{t("note.totp")}</dt><dd>{account.privateDetails.totpSecret
        ? <AccountTotpPreview accountName={account.email} secret={account.privateDetails.totpSecret}
          masked={privacyMode} variant="inline" t={t} />
        : "-"}</dd></div>
    </dl>
  </section>;
}

export function AccountExpandedPanel({
  account,
  resetCredits,
  privacyMode,
  hideAccountNotes,
  onRefreshResetCredits,
  language,
  t,
}: {
  account: Account;
  resetCredits?: ResetCreditsLoadState;
  privacyMode: boolean;
  hideAccountNotes: boolean;
  onRefreshResetCredits: () => void;
  language: Language;
  t: Translate;
}) {
  const lastUpdated = resetCredits?.fetchedAt
    ? t("table.resetCreditsUpdated", { time: formatSystemTime(resetCredits.fetchedAt, language) })
    : t("table.resetCreditsUnknown");

  return (
    <div className="account-expanded-panel">
      <AccountExpandedDetails account={account} privacyMode={privacyMode}
        hideAccountNotes={hideAccountNotes} t={t} />
      <section className="account-reset-section" aria-labelledby={`reset-credits-${account.id}`}>
        <div className="account-reset-section-header">
          <h3 id={`reset-credits-${account.id}`}>{t("table.resetCredits")}</h3>
          <div className="account-reset-section-actions">
            <span>{lastUpdated}</span>
            <Button size="small"
              icon={<RefreshCw size={13} className={resetCredits?.status === "loading" ? "spin" : undefined} />}
              loading={resetCredits?.status === "loading"} onClick={onRefreshResetCredits}>
              {t("actions.refreshResetCredits")}
            </Button>
          </div>
        </div>
        <ResetCreditsPanel state={resetCredits} onRetry={onRefreshResetCredits} missingState="unknown"
          language={language} t={t} />
      </section>
    </div>
  );
}
