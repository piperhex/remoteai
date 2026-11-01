import { ChevronRight } from 'lucide-react';
import { AccountAvatarButton } from '../../../../../shared/lounge/AccountAvatarButton';
import { accountLabel } from '../../../../../shared/lounge/accountLabel';
import type { LoungeController } from '../../../../../shared/lounge/controller';
import { displayText as t } from '../../../../../shared/localization/messages';
import './cloudAccountIdentity.css';

export function CloudAccountIdentity({ controller, email, onDetails }: {
  controller: LoungeController; email: string; onDetails?: () => void;
}) {
  const copy = <span><strong>{accountLabel(email)}</strong><small>{t('client.settings.remoteAiCloudAccount')}</small></span>;
  return <div className="cloud-account-identity">
    <AccountAvatarButton controller={controller} account={email} />
    {onDetails ? <button type="button" className="cloud-account-identity-details"
      aria-label={t('client.settings.viewProfile')} onClick={onDetails}>{copy}<ChevronRight size={18} /></button> : copy}
  </div>;
}
