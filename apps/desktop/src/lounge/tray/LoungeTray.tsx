import { useLayoutEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useApplicationFontSize } from '../../../../../shared/appearance/useApplicationFontSize';
import { initials } from '../../../../../shared/lounge/types';
import { guiLanguage, uiText } from '../../../../../shared/localization/uiText';
import { localeForLanguage } from '../../../../../shared/localization/language';
import type { TrayAction, TrayMessage, TraySender } from '../trayMessages';
import { useTraySnapshot } from './useTraySnapshot';
import './loungeTray.css';

function TrayRow({ message, sender, time, open }: {
  message: TrayMessage; sender?: TraySender; time: Intl.DateTimeFormat; open: () => void;
}) {
  const date = new Date(message.sentAt);
  const preview = message.text || uiText('client.lounge.quotedImages', { count: message.imageCount });
  return <li>
    <button type="button" className="lounge-tray-row" onClick={open}>
      <span className="lounge-tray-avatar" aria-hidden="true">
        {sender?.avatar ? <img src={sender.avatar} alt="" /> : initials(sender?.name ?? '')}
      </span>
      <span className="lounge-tray-message">
        <strong>{sender?.name}</strong>
        <span>{preview}</span>
      </span>
      <time dateTime={message.sentAt}>{time.format(date)}</time>
    </button>
  </li>;
}

export function LoungeTray() {
  const snapshot = useTraySnapshot();
  const fontSize = useApplicationFontSize();
  const panel = useRef<HTMLElement>(null);
  const language = guiLanguage();
  const title = uiText('client.lounge.trayUnread');
  const time = new Intl.DateTimeFormat(localeForLanguage(language), { hour: '2-digit', minute: '2-digit' });
  useLayoutEffect(() => {
    const element = panel.current;
    if (!snapshot?.messages.length || !element) return;
    document.documentElement.lang = localeForLanguage(language);
    void invoke('lounge_tray_present', { revision: snapshot.revision, height: element.offsetHeight })
      .catch(console.error);
  }, [snapshot, fontSize, language]);
  if (!snapshot?.messages.length) return null;

  const activate = (action: TrayAction) => {
    void invoke('lounge_tray_activate', { revision: snapshot.revision, action }).catch(console.error);
  };
  return <section ref={panel} className="lounge-tray-panel" aria-label={title}
    onKeyDown={event => { if (event.key === 'Escape') activate({ type: 'dismiss' }); }}>
    <header>{title}</header>
    <ul>
      {snapshot.messages.map(message => <TrayRow key={message.key} message={message}
        sender={snapshot.senders[message.senderId]} time={time}
        open={() => activate({ type: 'open', key: message.key })} />)}
    </ul>
    <footer>
      <button type="button" onClick={() => activate({ type: 'ignore' })}>{uiText('client.lounge.trayIgnoreAll')}</button>
      <button type="button" onClick={() => activate({ type: 'viewAll' })}>{uiText('client.lounge.trayViewAll')}</button>
    </footer>
  </section>;
}
