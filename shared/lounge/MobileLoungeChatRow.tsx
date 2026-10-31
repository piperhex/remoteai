import { accountName } from './names';
import { Ban, BellOff, MessagesSquare, Pin } from 'lucide-react';
import { displayText as t } from '../localization/messages';
import { contactStatus } from './contacts';
import type { ConversationRow } from './conversationRows';
import { conversationPreviewText } from './conversationPreview';
import type { MobileLounge } from './useMobileLounge';
import { LoungeAvatar } from './LoungeAvatar';
import { LoungeUnreadBadge } from './LoungeUnreadBadge';

export function MobileLoungeChatRow({ row, model }: { row: ConversationRow; model: MobileLounge }) {
  return <div className="lounge-chat-row">
    <button className="lounge-chat-row-main" type="button"
      aria-label={row.user ? t('client.lounge.directWith', { account: accountName(row.user) }) : t('client.lounge.groupChat')}
      aria-description={row.blocked ? t('client.lounge.blocked')
        : row.contact ? t(contactStatus(row.contact)) : undefined}
      onClick={() => model.select(row.user)}>
      <span className="lounge-chat-avatar">
        {row.user ? <>
          <LoungeAvatar user={row.user} />
          <span aria-hidden className={`lounge-avatar-presence${row.online ? ' is-online' : ''}`} />
        </> : <span className="lounge-avatar" aria-hidden>
          <MessagesSquare size={22} /></span>}
        <LoungeUnreadBadge count={row.unread} />
      </span>
      <span className="lounge-chat-row-copy"><strong className="lounge-chat-row-identity">
        <span>{row.user ? accountName(row.user) : t('client.lounge.groupChat')}</span>
        {row.blocked && <Ban size={14} className="lounge-chat-row-blocked" role="img"
          aria-label={t('client.lounge.blocked')} />}</strong>
        <span>{conversationPreviewText(row)}</span></span>
      <span className="lounge-chat-row-meta">
        {row.contact?.pinned && <Pin size={14} className="lounge-pin" role="img"
          aria-label={t('client.lounge.pinned')} />}
        {row.last && <time>{new Date(row.last.sentAt).toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit' })}</time>}
        {row.notificationsMuted && <BellOff size={14} className="lounge-pin"
          aria-label={t('client.lounge.notificationsMuted')} />}
      </span>
    </button>
  </div>;
}
