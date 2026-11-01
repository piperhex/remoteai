import { accountName } from './names';
import { useState } from 'react';
import { initials, type LoungeAccount } from './types';
import { displayText as t } from '../localization/messages';
import { LoungeAvatarMenu } from './LoungeAvatarMenu';
import { useThreadLongPress } from '../chat/useThreadLongPress';
import './avatar.css';

export function LoungeAvatar({ user, onDirect, onProfile, onMention, onLongPress }: {
  user: LoungeAccount; onDirect?: () => void; onProfile?: () => void; onMention?: () => void;
  onLongPress?: () => void;
}) {
  const [failedSource, setFailedSource] = useState<string>();
  const gestures = useThreadLongPress(() => onLongPress?.(), { enabled: !!onLongPress });
  const content = user.avatar && failedSource !== user.avatar
      ? <img src={user.avatar} alt="" width={48} height={48} draggable={false}
          onError={() => setFailedSource(user.avatar)} />
      : initials(accountName(user));
  const action = onProfile ?? onDirect;
  const avatar = action ? <button type="button" className="lounge-avatar lounge-avatar-direct" onClick={action}
    {...(onLongPress ? { ...gestures, onContextMenu: event => event.preventDefault(),
      onMouseDown: event => event.preventDefault(),
      style: { userSelect: 'none', WebkitTouchCallout: 'none' } } : {})}
    aria-label={t(onProfile ? 'client.lounge.viewProfile' : 'client.lounge.directWith', {
      account: accountName(user) })}>{content}</button>
    : <span className="lounge-avatar" aria-hidden>{content}</span>;
  return onMention ? <LoungeAvatarMenu user={user} mention={onMention}>{avatar}</LoungeAvatarMenu> : avatar;
}
