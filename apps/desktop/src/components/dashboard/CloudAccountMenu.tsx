import { Dropdown, type MenuProps } from 'antd';
import { ChevronDown } from 'lucide-react';
import { LoungeAvatar } from '../../../../../shared/lounge/LoungeAvatar';
import { accountLabel } from '../../../../../shared/lounge/accountLabel';
import type { LoungeAccount } from '../../../../../shared/lounge/types';
import type { Translate } from '../../i18n';
import './cloudAccountIdentity.css';

export function CloudAccountMenu({ email, user, authenticated, loading, menu, t }: {
  email?: string | null; user?: LoungeAccount; authenticated: boolean; loading: boolean;
  menu: MenuProps; t: Translate;
}) {
  const label = authenticated ? accountLabel(email ?? '') || t('cloud.signedIn') : t('cloud.login');
  return <Dropdown trigger={['click']} menu={menu}>
    <button type="button" className={`cloud-avatar-button${authenticated ? ' authenticated' : ''}`}
      aria-label={t(authenticated ? 'cloud.accountDetails' : 'cloud.login')} title={label} disabled={loading}>
      {authenticated && <LoungeAvatar user={user ?? { id: '', account: email ?? '' }} />}
      <span>{label}</span><ChevronDown size={14} />
    </button>
  </Dropdown>;
}
