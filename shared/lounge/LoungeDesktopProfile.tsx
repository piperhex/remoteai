import { Button, Modal } from 'antd';
import type { LoungeAccount, LoungeSnapshot } from './types';
import type { LoungeController } from './controller';
import { LoungeNameFields } from './LoungeNameFields';
import { LoungeAvatar } from './LoungeAvatar';
import { accountName } from './names';
import { displayText as t } from '../localization/messages';
import { useLoungeNameNavigation } from './useLoungeNameNavigation';
import { X } from 'lucide-react';
import './desktopProfile.css';

export function LoungeDesktopProfile({ user, state, controller, close, editAvatar }: {
  user: LoungeAccount; state: LoungeSnapshot; controller: LoungeController; close: () => void; editAvatar: () => void;
}) {
  const navigation = useLoungeNameNavigation();
  const current = user.id === state.user?.id ? state.user
    : state.contacts.find(contact => contact.user.id === user.id)?.user ?? user;
  const own = current.id === state.user?.id;
  return <Modal open centered width={600} className="lounge-desktop-profile-dialog" closeIcon={<X size={24} />}
    title={t(own ? 'client.lounge.accountSettings' : 'client.lounge.profile')}
    onCancel={() => void navigation.leave(close)} footer={null}>
    <section className="lounge-desktop-profile">
      <div className="lounge-profile-identity">
        <LoungeAvatar user={current} />
        <div className="lounge-profile-identity-copy"><h2>{accountName(current)}</h2>
          {accountName(current) !== current.account && <p className="lounge-profile-email">{current.account}</p>}
          {own && <Button onClick={() => void navigation.leave(editAvatar)}>{t('client.lounge.editAvatar')}</Button>}
        </div>
      </div>
      <LoungeNameFields key={current.id} user={current} state={state} controller={controller}
        saveRef={navigation.saveRef} desktop />
    </section>
  </Modal>;
}
