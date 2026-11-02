import { accountName, accountMatches } from './names';
import { useState } from 'react';
import { BellOff, MessageCircle, Pin, Plus } from 'lucide-react';
import { ThreadContextMenu } from '../chat/ThreadContextMenu';
import { displayText as t } from '../localization/messages';
import type { LoungeAccount, LoungeSnapshot } from './types';
import { contactStatus, orderedDirectContacts } from './contacts';
import { LoungeAvatar } from './LoungeAvatar';
import { LoungeMyAccount } from './LoungeMyAccount';
import './contextMenu.css';
import type { LoungeController } from './controller';
import { useLoungeNotificationSettings } from './useLoungeNotificationSettings';
import { notificationActionLabel } from './notificationSettings';
import { LoungeUnreadBadge } from './LoungeUnreadBadge';

export function LoungePeople({ state, controller, select, block, newChat, pin, profile }: {
  controller: LoungeController;
  state: LoungeSnapshot; select: (user?: LoungeAccount) => void; block: (user: LoungeAccount) => void;
  newChat: () => void;
  pin: (userId: string, pinned: boolean) => void;
  profile: (user: LoungeAccount) => void;
}) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<string>();
  const notifications = useLoungeNotificationSettings(controller);
  const muted = (id: string) => state.mutedConversations?.includes(id) ?? false;
  const notificationItem = (id: string) => ({ key: 'notifications', label: t(notificationActionLabel(muted(id))),
    disabled: !state.notificationSettingsAvailable || state.status !== 'connected' || notifications.busy });
  const toggleNotifications = (id: string) => { void notifications.save(id, !muted(id)); };
  const contacts = orderedDirectContacts(state.contacts, state.user?.id).filter(contact =>
    accountMatches(contact.user, query));
  return <nav className="lounge-people" aria-label={t('client.lounge.people')}>
    <div className="lounge-people-heading"><h2>{t('client.lounge.people')}</h2>
      <button type="button" className="lounge-new-chat-button" onClick={newChat} disabled={!state.directAvailable}>
        <Plus size={15} aria-hidden="true" />{t('client.lounge.newChat')}</button></div>
    <input aria-label={t('client.lounge.peopleSearch')} placeholder={t('client.lounge.peopleSearch')}
      value={query} onChange={event => setQuery(event.target.value)} />
    {notifications.error && <p role="alert" className="lounge-notification-error">
      {t('client.lounge.notificationSaveFailed')}</p>}
    <div className="lounge-people-list">
      <ThreadContextMenu overlayClassName="lounge-context-menu" open={menu === ''}
        onOpenChange={open => setMenu(open ? '' : undefined)} menu={{ items: [notificationItem('')],
          onClick: () => { setMenu(undefined); toggleNotifications(''); } }}>
        <button type="button" className={`lounge-person${!state.conversation ? ' is-selected' : ''}`}
          aria-current={!state.conversation ? 'page' : undefined} onClick={() => select()}>
          <span className="lounge-unread-avatar"><span className="lounge-avatar"><MessageCircle size={22} /></span>
            <LoungeUnreadBadge count={state.unreadByConversation['']} /></span>
          <span className="lounge-person-copy">{t('client.lounge.groupChat')}</span>
          {muted('') && <BellOff size={14} className="lounge-pin" aria-label={t('client.lounge.notificationsMuted')} />}
        </button>
      </ThreadContextMenu>
      {!contacts.length && <p>{t('client.lounge.noPeople')}</p>}
      {contacts.map(contact => <ThreadContextMenu key={contact.user.id} overlayClassName="lounge-context-menu"
        open={menu === contact.user.id} onOpenChange={open => setMenu(open ? contact.user.id : undefined)}
        menu={{ items: [{ key: 'direct', label: t('client.lounge.directChat') },
          { key: 'profile', label: t('client.lounge.profile') },
          { key: 'pin', label: t(contact.pinned ? 'client.lounge.unpinChat' : 'client.lounge.pinChat') },
          notificationItem(contact.user.id),
          ...(state.directAvailable ? [{ key: 'block', label: t(state.blocked.includes(contact.user.id)
            ? 'client.lounge.unblockUser' : 'client.lounge.blockUser') }] : [])],
        onClick: ({ key }) => {
          setMenu(undefined);
          if (key === 'pin') pin(contact.user.id, !contact.pinned);
          else if (key === 'notifications') toggleNotifications(contact.user.id);
          else if (key === 'profile') profile(contact.user);
          else if (key === 'direct') select(contact.user); else block(contact.user);
        } }}>
        <button type="button"
          className={`lounge-person${state.conversation === contact.user.id ? ' is-selected' : ''}`}
          aria-label={t('client.lounge.directWith', { account: accountName(contact.user) })}
          aria-description={t(contactStatus(contact))}
          aria-current={state.conversation === contact.user.id ? 'page' : undefined} onClick={() => select(contact.user)}>
          <span className="lounge-unread-avatar"><LoungeAvatar user={contact.user} />
            <span aria-hidden className={`lounge-avatar-presence${state.status === 'connected'
              && contact.online === true ? ' is-online' : ''}`} />
            <LoungeUnreadBadge count={state.unreadByConversation[contact.user.id]} /></span>
          <span className="lounge-person-copy">
            <span>{accountName(contact.user)}</span>
            {state.blocked.includes(contact.user.id) && <small>{t('client.lounge.blocked')}</small>}
          </span>{contact.pinned && <Pin size={14} className="lounge-pin" role="img"
            aria-label={t('client.lounge.pinned')} />}
          {muted(contact.user.id) && <BellOff size={14} className="lounge-pin"
            aria-label={t('client.lounge.notificationsMuted')} />}
        </button>
      </ThreadContextMenu>)}
    </div>
    {state.user && <LoungeMyAccount key={state.user.id} user={state.user} settings={profile} />}
  </nav>;
}
