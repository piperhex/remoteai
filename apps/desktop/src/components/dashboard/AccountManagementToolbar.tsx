import type { KeyboardEvent, ReactNode } from "react";
import { Bot, Network, UserRound } from "lucide-react";
import type { Translate } from "../../i18n";
import type { AccountManagementPage } from "./DashboardNavigation";
import styles from "./AccountManagementToolbar.module.less";

interface AccountManagementToolbarProps {
  section: AccountManagementPage;
  onSectionChange: (section: AccountManagementPage) => void;
  children: ReactNode;
  sharedActions?: ReactNode;
  summary?: ReactNode;
  t: Translate;
}

const SECTIONS = [
  { value: "accounts", icon: UserRound, label: "accounts.officialTab" },
  { value: "providers", icon: Network, label: "nav.providers" },
  { value: "claudeCode", icon: Bot, label: "nav.claudeCode" },
] as const;

export function AccountManagementToolbar({
  section, onSectionChange, children, sharedActions, summary, t,
}: AccountManagementToolbarProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: 0 }[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    const current = SECTIONS.findIndex((item) => item.value === section);
    let next = (current + direction + SECTIONS.length) % SECTIONS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = SECTIONS.length - 1;
    const value = SECTIONS[next].value;
    onSectionChange(value);
    document.getElementById(`account-section-${value}`)?.focus();
  };

  return (
    <header className={`${styles.toolbar}${summary ? "" : ` ${styles.compact}`}`}>
      <div className={styles.heading}>
        {summary && <div className={styles.summary}>{summary}</div>}
        <div className={styles.tabs} role="tablist" aria-label={t("nav.accounts")}>
          {SECTIONS.map(({ value, icon: Icon, label }) => (
            <button key={value} id={`account-section-${value}`} type="button" role="tab"
              aria-selected={section === value} aria-controls={`account-panel-${value}`}
              tabIndex={section === value ? 0 : -1} onKeyDown={handleKeyDown}
              onClick={() => onSectionChange(value)}>
              <Icon size={19} aria-hidden="true" /><span>{t(label)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={`topbar-actions ${styles.actions}`}>
        <div className={styles.sectionActions}>{children}</div>
        {sharedActions && <div className={styles.sharedActions}>{sharedActions}</div>}
      </div>
    </header>
  );
}
