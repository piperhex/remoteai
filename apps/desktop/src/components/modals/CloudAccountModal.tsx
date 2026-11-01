import { useState, type FormEvent } from "react";
import { ExternalLink, KeyRound, LockKeyhole, Mail, Server, UserRound, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { LoungeController } from '../../../../../shared/lounge/controller';
import { CloudAccountIdentity } from '../dashboard/CloudAccountIdentity';

interface CloudAccountModalProps {
  email?: string | null;
  baseUrl?: string | null;
  changingPassword: boolean;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  onClose: () => void;
  onOpenPasswordReset: () => void;
  t: Translate;
  loungeController: LoungeController;
}

export function CloudAccountModal({
  email,
  baseUrl,
  changingPassword,
  onChangePassword,
  onClose,
  onOpenPasswordReset,
  t,
  loungeController,
}: CloudAccountModalProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordsMatch = !confirmPassword || newPassword === confirmPassword;
  const canSubmit = currentPassword.length >= 6
    && newPassword.length >= 8
    && newPassword === confirmPassword;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || changingPassword) return;
    const changed = await onChangePassword(currentPassword, newPassword);
    if (changed) onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !changingPassword) onClose();
    }}>
      <section className="modal cloud-account-modal" role="dialog" aria-modal="true"
        aria-labelledby="cloud-account-title">
        <button type="button" className="modal-close" aria-label={t("cloudAccount.close")}
          disabled={changingPassword} onClick={onClose}><X size={19} /></button>
        <div className="modal-icon"><UserRound size={24} /></div>
        <h2 id="cloud-account-title">{t("cloudAccount.title")}</h2>
        <p>{t("cloudAccount.description")}</p>
        <CloudAccountIdentity controller={loungeController} email={email ?? ''} />

        <div className="cloud-account-details">
          <div><Mail size={16} /><span><small>{t("cloudAccount.email")}</small><b>{email ?? "-"}</b></span></div>
          <div><Server size={16} /><span><small>{t("cloudAccount.server")}</small><b>{baseUrl ?? "-"}</b></span></div>
        </div>

        <form className="cloud-account-password-form" onSubmit={(event) => void submit(event)}>
          <div className="cloud-account-section-heading">
            <KeyRound size={17} />
            <span><b>{t("cloudAccount.changePassword")}</b><small>{t("cloudAccount.changePasswordHint")}</small></span>
          </div>

          <label htmlFor="cloud-current-password">{t("cloudAccount.currentPassword")}</label>
          <span className="cloud-login-input"><LockKeyhole size={16} />
            <input id="cloud-current-password" type="password" autoComplete="current-password"
              minLength={6} value={currentPassword} disabled={changingPassword} autoFocus
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder={t("cloudAccount.currentPasswordPlaceholder")} /></span>

          <label htmlFor="cloud-new-password">{t("cloudAccount.newPassword")}</label>
          <span className="cloud-login-input"><LockKeyhole size={16} />
            <input id="cloud-new-password" type="password" autoComplete="new-password"
              minLength={8} value={newPassword} disabled={changingPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={t("cloudAccount.newPasswordPlaceholder")} /></span>

          <label htmlFor="cloud-confirm-password">{t("cloudAccount.confirmPassword")}</label>
          <span className={`cloud-login-input ${passwordsMatch ? "" : "invalid"}`}><LockKeyhole size={16} />
            <input id="cloud-confirm-password" type="password" autoComplete="new-password"
              minLength={8} value={confirmPassword} disabled={changingPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t("cloudAccount.confirmPasswordPlaceholder")} /></span>
          {!passwordsMatch && <small className="cloud-account-validation" role="alert">
            {t("cloudAccount.passwordMismatch")}
          </small>}

          <button type="submit" className="primary-button cloud-account-submit"
            disabled={!canSubmit || changingPassword}>
            <KeyRound size={16} />
            {changingPassword ? t("cloudAccount.changingPassword") : t("cloudAccount.submit")}
          </button>
        </form>

        <div className="cloud-account-reset">
          <span><b>{t("cloudAccount.resetTitle")}</b><small>{t("cloudAccount.resetDescription")}</small></span>
          <button type="button" disabled={changingPassword} onClick={onOpenPasswordReset}>
            {t("cloudAccount.openReset")}<ExternalLink size={15} />
          </button>
        </div>
      </section>
    </div>
  );
}
