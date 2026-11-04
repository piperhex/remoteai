import inlineCopy from '@remoteai/i18n/copy/inline/desktop/components/accounts/AccountTableParts/index';
import { interpolate as interpolateCopy } from '@remoteai/i18n';
import { uiText } from "../../../../../../shared/localization/uiText";
import { useEffect, useRef, useState } from "react";
import { Button, InputNumber, Popover, Tooltip } from "antd";
import { CalendarClock, Check, Copy, Eye, EyeOff, Pencil, Settings, X } from "lucide-react";
import type { Language, Translate } from "../../../i18n";
import type {
  Account,
  ResetCreditsLoadState,
} from "../../../types";
import { formatCompactTokenCount } from "../../../../../../shared/context-usage/format";
import { shouldShowUsageError } from "../../../utils/usageErrors";
import {
  DailyTokenUsageTooltip,
  type TokenTypeTotals,
} from "../../DailyTokenUsageTooltip";
import { ResetCreditsPanel } from "../ResetCreditsPanel";
import styles from "./index.module.less";

const EMAIL_COPY_FEEDBACK_DURATION_MS = 1_600;

export function AccountPrivacyToggle({ enabled, loading, onChange, t }: {
  enabled: boolean;
  loading: boolean;
  onChange: (enabled: boolean) => void;
  t: Translate;
}) {
  const label = enabled ? t("table.showAccountDetails") : t("table.hideAccountDetails");
  return (
    <Tooltip title={label}>
      <Button
        type="text"
        size="small"
        className="account-privacy-toggle"
        loading={loading}
        aria-label={label}
        aria-pressed={enabled}
        title={label}
        onClick={() => onChange(!enabled)}
        icon={enabled ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
      />
    </Tooltip>
  );
}

export function resetCreditsCount(state?: ResetCreditsLoadState) {
  return state?.status === "loaded" ? state.data.credits.length : null;
}

export function AccountResetCreditCount({ count, language }: { count: number | null; language: Language }) {
  if (!count) return null;
  const label = (language !== "zh" && language !== "en" ? uiText("client.usage.resetCards", { value1: count }, language) : language === "zh" ? interpolateCopy(inlineCopy["value1_0f4f3650"], { value1: String(count) }) : interpolateCopy(inlineCopy["value1_reset_cardvalue2_4b78918e"], { value1: String(count), value2: String(count === 1 ? "" : "s") }));
  return <span className="account-reset-credit-count"><span aria-hidden="true">·</span>{label}</span>;
}

export function CopyableAccountEmail({ email, displayEmail, t }: {
  email: string;
  displayEmail: string;
  t: Translate;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), EMAIL_COPY_FEEDBACK_DURATION_MS);
    } catch {
      setCopied(false);
    }
  };

  const label = copied ? t("totp.copied") : t("table.copyEmail");
  return (
    <Tooltip title={label}>
      <button type="button" className={`account-email-copy${copied ? " copied" : ""}`}
        aria-label={label} onClick={(event) => {
          event.stopPropagation();
          void copyEmail();
        }}>
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        <span className="account-email">{displayEmail}</span>
      </button>
    </Tooltip>
  );
}

export function CompactDailyTokenChart({ totals, language }: {
  totals: TokenTypeTotals;
  language: Language;
}) {
  const values = [totals.input, totals.output, totals.reasoning, totals.cached];
  const maximum = Math.max(...values, 1);
  const title = (language !== "zh" && language !== "en" ? uiText("client.usage.todaySTokenUsage", {}, language) : language === "zh" ? inlineCopy["Token_ce3351b6"] : inlineCopy["Todays_Token_usage_6d7b75c8"]);
  return (
    <Tooltip title={<DailyTokenUsageTooltip totals={totals} language={language} />} placement="top">
      <div className={`compact-model-token-chart ${styles.compactModelTokenChart}`} role="img"
        aria-label={`${title}: ${formatCompactTokenCount(totals.total, language)}`}>
        <span>{(language !== "zh" && language !== "en" ? uiText("client.chat.today", {}, language) : language === "zh" ? inlineCopy["text_5c9cf5e0"] : inlineCopy["TODAY_ea4171ae"])}</span>
        <svg viewBox="0 0 48 26" aria-hidden="true">
          {values.map((value, index) => {
            const height = value > 0 ? Math.max(3, Math.round((value / maximum) * 22)) : 2;
            return <rect key={index} className={`token-type-${index}`} x={index * 12 + 2}
              y={24 - height} width="8" height={height} rx="2" />;
          })}
        </svg>
        <small>{formatCompactTokenCount(totals.total, language)}</small>
      </div>
    </Tooltip>
  );
}

export function canEditAccountMetadata(account: Account) {
  return !account.official || account.metadataEditable;
}

export function AccountNoteEditButton({ account, hideAccountNotes, onEdit, t }: {
  account: Account;
  hideAccountNotes: boolean;
  onEdit: () => void;
  t: Translate;
}) {
  const noteText = hideAccountNotes && account.note ? "**********" : account.note || t("table.noNote");
  const editable = canEditAccountMetadata(account);

  return <button type="button" className={`account-note-edit${account.note ? "" : " empty"}`}
    disabled={!editable} title={editable ? noteText : t("table.officialMetadataReadOnly")} onClick={onEdit}>
    <Pencil size={11} aria-hidden="true" />
    <span>{noteText}</span>
  </button>;
}

export function AutoSwitchPriorityInput({ account, disabled, onSave, t, autoFocus, onFinish }: {
  account: Account;
  disabled: boolean;
  onSave: (id: string, priority: number) => Promise<boolean>;
  t: Translate;
  autoFocus?: boolean;
  onFinish?: () => void;
}) {
  const [value, setValue] = useState<number | null>(account.autoSwitchPriority);
  const latestValue = useRef(value);
  const updateValue = (nextValue: number | null) => {
    latestValue.current = nextValue;
    setValue(nextValue);
  };
  useEffect(() => updateValue(account.autoSwitchPriority), [account.autoSwitchPriority]);

  const save = async () => {
    const priority = latestValue.current === null ? 0 : Math.trunc(latestValue.current);
    updateValue(priority);
    if (priority !== account.autoSwitchPriority && !await onSave(account.id, priority)) {
      updateValue(account.autoSwitchPriority);
    }
    onFinish?.();
  };

  return <InputNumber className="auto-switch-priority-input" size="small" precision={0} step={1}
    min={-2_147_483_648} max={2_147_483_647} value={value} disabled={disabled} autoFocus={autoFocus}
    aria-label={t("table.autoSwitchPriority")} onChange={updateValue}
    // InputNumber finishes range/precision correction while the blur event bubbles.
    onBlur={() => queueMicrotask(() => void save())} onPressEnter={(event) => {
      if (event.target instanceof HTMLInputElement) event.target.blur();
    }} />;
}

export function AutoSwitchThresholdInput({ account, disabled, onSave, t, autoFocus, onFinish }: {
  account: Account;
  disabled: boolean;
  onSave: (id: string, threshold: number) => Promise<boolean>;
  t: Translate;
  autoFocus?: boolean;
  onFinish?: () => void;
}) {
  const [value, setValue] = useState<number | null>(account.autoSwitchThreshold);
  const latestValue = useRef(value);
  const updateValue = (nextValue: number | null) => {
    latestValue.current = nextValue;
    setValue(nextValue);
  };
  useEffect(() => updateValue(account.autoSwitchThreshold), [account.autoSwitchThreshold]);

  const save = async () => {
    const threshold = latestValue.current === null ? 0 : Math.min(100, Math.max(0, latestValue.current));
    updateValue(threshold);
    if (threshold !== account.autoSwitchThreshold && !await onSave(account.id, threshold)) {
      updateValue(account.autoSwitchThreshold);
    }
    onFinish?.();
  };

  return <InputNumber className="auto-switch-threshold-input" size="small" precision={1} step={1}
    min={0} max={100} suffix="%" value={value} disabled={disabled} autoFocus={autoFocus}
    aria-label={t("table.autoSwitchThreshold")} onChange={updateValue}
    // InputNumber finishes range/precision correction while the blur event bubbles.
    onBlur={() => queueMicrotask(() => void save())} onPressEnter={(event) => {
      if (event.target instanceof HTMLInputElement) event.target.blur();
    }} />;
}

function GlobalThresholdEditor({ value, disabled, saving, onChange, onSave, t }: {
  value: number | null;
  disabled: boolean;
  saving: boolean;
  onChange: (value: number | null) => void;
  onSave: () => void;
  t: Translate;
}) {
  return <div className="global-threshold-popover">
    <p>{t("table.globalAutoSwitchThresholdDescription")}</p>
    <div>
      <InputNumber size="small" precision={1} step={1} min={0} max={100} suffix="%"
        value={value} disabled={saving || disabled} onChange={onChange}
        aria-label={t("table.globalAutoSwitchThreshold")} />
      <Button type="primary" size="small" loading={saving} disabled={disabled}
        onClick={onSave}>{t("table.saveGlobalThreshold")}</Button>
    </div>
  </div>;
}

export function GlobalAutoSwitchThresholdControl({ threshold, disabled, onSave, t }: {
  threshold: number;
  disabled: boolean;
  onSave: (threshold: number) => Promise<boolean>;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<number | null>(threshold);
  useEffect(() => setValue(threshold), [threshold]);

  const save = async () => {
    const nextThreshold = value === null ? 0 : Math.min(100, Math.max(0, value));
    setValue(nextThreshold);
    if (nextThreshold === threshold) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const saved = await onSave(nextThreshold);
    setSaving(false);
    if (saved) setOpen(false);
    else setValue(threshold);
  };

  const content = <GlobalThresholdEditor value={value} disabled={disabled} saving={saving}
    onChange={setValue} onSave={() => void save()} t={t} />;

  return <span className="auto-switch-threshold-title">
    <span>{t("table.autoSwitchThreshold")}</span>
    <Popover title={t("table.globalAutoSwitchThreshold")} content={content} trigger="click"
      open={open} placement="bottomRight" styles={{ root: { maxWidth: 400 } }}
      onOpenChange={(nextOpen) => {
        if (!saving) {
          setValue(threshold);
          setOpen(nextOpen);
        }
      }}>
      <Tooltip title={t("table.globalAutoSwitchThresholdTooltip")}>
        <Button type="text" size="small" disabled={disabled} icon={<Settings size={14} />}
          aria-label={t("table.globalAutoSwitchThreshold")} />
      </Tooltip>
    </Popover>
  </span>;
}

export function ResetCreditsModal({ state, onClose, onRetry, language, t }: {
  state?: ResetCreditsLoadState;
  onClose: () => void;
  onRetry: () => void;
  language: Language;
  t: Translate;
}) {
  const count = resetCreditsCount(state);
  return <div className="modal-backdrop">
    <div className="modal reset-credits-modal">
      <button className="modal-close" onClick={onClose} aria-label={t("table.cancel")}><X size={17} /></button>
      <div className="modal-icon"><CalendarClock size={22} /></div>
      <h2>{t("table.resetCredits")}</h2>
      <p>{t("table.resetCredits")}: {count ?? "-"}</p>
      <ResetCreditsPanel state={state} onRetry={onRetry} language={language} t={t} />
    </div>
  </div>;
}

export function needsAccountAttention(account: Account, hotSwitchEnabled: boolean, showUsageNetworkErrors: boolean) {
  return shouldShowUsageError(account.usage.error, showUsageNetworkErrors)
    || (hotSwitchEnabled && !account.autoSwitchEnabled);
}
