import { useState, useSyncExternalStore } from 'react';
import { displayText as t } from '../localization/messages';
import type { LoungeController } from './controller';
import { LoungeAvatar } from './LoungeAvatar';
import { LoungeAvatarSettings } from './LoungeAvatarSettings';
import './accountAvatar.css';

/** Reuse the signed-in chat connection so profile edits update every account entry immediately. */
export function AccountAvatarButton({ controller, account }: { controller: LoungeController; account: string }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [editing, setEditing] = useState<LoungeController>();
  const user = state.user ?? { id: '', account };
  return <>
    <button type="button" className="account-avatar-edit" aria-label={t('client.lounge.editAvatar')}
      onClick={() => setEditing(controller)}><LoungeAvatar user={user} /></button>
    {editing === controller && <LoungeAvatarSettings key={user.id || account} user={user}
      controller={controller} close={() => setEditing(undefined)} />}
  </>;
}
