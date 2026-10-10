import type { Translate } from "../../i18n";
import { initials } from "../../utils/format";
import styles from "./AccountAvatar.module.less";

interface AccountAvatarProps {
  email: string;
  disabled: boolean;
  officialAuthActive: boolean;
  busy: boolean;
  variant: "table" | "card";
  onClearOfficialAuth: () => void;
  t: Translate;
}

export function AccountAvatar({
  email, disabled, officialAuthActive, busy, variant, onClearOfficialAuth, t,
}: AccountAvatarProps) {
  const className = `${variant === "table" ? "table-avatar" : "avatar"}${disabled ? " disabled-avatar" : ""}`;
  if (!officialAuthActive) {
    return <div className={className}>{disabled && variant === "table" ? t("table.disabled") : initials(email)}</div>;
  }

  return (
    <button type="button" className={`${className} ${styles.loginAvatar} ${styles[variant]}`}
      disabled={busy} aria-label={t("providers.proxy.deactivateOpenaiAuthAccount")}
      title={t("providers.proxy.deactivateOpenaiAuthAccount")}
      onClick={(event) => {
        event.stopPropagation();
        onClearOfficialAuth();
      }}>
      <span className={styles.loginLabel}>{t("table.loginState")}</span>
    </button>
  );
}
