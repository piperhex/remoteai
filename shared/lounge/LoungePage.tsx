import { accountName } from './names';
import { LoungeSyncNotice } from './LoungeSyncNotice';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, Coffee, Users } from 'lucide-react';
import { Drawer } from 'antd';
import { displayText as t } from '../localization/messages';
import { getInterfaceLanguage, subscribeInterfaceLanguage } from '../localization/interfaceLanguage';
import { localeForLanguage } from '../localization/language';
import { type LoungeAccount, type LoungeMessage } from './types';
import type { LoungeController } from './controller';
import { LoungeComposer, type LoungeComposerHandle } from './LoungeComposer';
import { LoungeModeration } from './LoungeModeration';
import { LoungeAvatar } from './LoungeAvatar';
import { LoungeSender } from './LoungeSender';
import { LoungeAvatarSettings } from './LoungeAvatarSettings';
import { LoungeMessageBody } from './LoungeMessageBody';
import { LoungeHistory } from './LoungeHistory';
import { LoungePreview } from './LoungePreview';
import { quoteMessage, type LoungeReply } from './reply';
import { LoungePeople } from './LoungePeople';
import { LoungeNewChat } from './LoungeNewChat';
import { LoungeBlockDialog } from './LoungeBlockDialog';
import { contactStatus } from './contacts';
import './lounge.css';
import './people.css';
import { MobileLoungePage } from './MobileLoungePage';
import { historyKey } from './archive';
import { useLoungeNavigation } from './useLoungeNavigation';
import { scrollToLoungeMessage } from './scrollToMessage';
import { LoungeDesktopProfile } from './LoungeDesktopProfile';
import { LoungeAssistanceButton, LoungeAssistanceProvider, type RequestLoungeAssistance } from './LoungeAssistance';

export function LoungePage(props: {
  controller: LoungeController; onLogin?: () => void; mobile?: boolean; onBack?: () => void;
  onAssistance?: RequestLoungeAssistance;
}) {
  return props.mobile ? <MobileLoungePage key={props.controller.snapshot().user?.id} {...props} />
    : <LoungeAssistanceProvider request={props.onAssistance}>
      <DesktopLoungePage {...props} /></LoungeAssistanceProvider>;
}

function DesktopLoungePage({ controller, onLogin, mobile = false }: {
  controller: LoungeController; onLogin?: () => void; mobile?: boolean;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const navigation = useLoungeNavigation(controller, state);
  const language = useSyncExternalStore(subscribeInterfaceLanguage, getInterfaceLanguage);
  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<LoungeComposerHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [preview, setPreview] = useState<string>();
  const [moderating, setModerating] = useState<LoungeAccount>();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reply, setReply] = useState<LoungeReply>();
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const newChat = () => { setPeopleOpen(false); setNewChatOpen(true); };
  const [blocking, setBlocking] = useState<LoungeAccount>();
  const [profile, setProfile] = useState<LoungeAccount>();
  const showProfile = (user: LoungeAccount) => { setPeopleOpen(false); setProfile(user); };
  const contact = state.contacts.find(value => value.user.id === state.conversation);
  const select = (user?: LoungeAccount) => {
    navigation.clear(); controller.selectConversation(user); setPeopleOpen(false); setAtBottom(true);
  };
  const locate = async (reference: LoungeReply) => {
    if (!await navigation.locate(reference)) return;
    setAtBottom(false); setHistoryOpen(false);
  };
  useLayoutEffect(() => {
    if (!navigation.focus) return;
    const frame = requestAnimationFrame(() => scrollToLoungeMessage(list.current, navigation.focus!.key));
    return () => cancelAnimationFrame(frame);
  }, [navigation.focus]);
  useEffect(() => setReply(undefined), [controller, state.conversation]);
  const quote = (message: LoungeMessage) => { setReply(quoteMessage(message)); setHistoryOpen(false); };
  const [now, setNow] = useState(Date.now);
  const mutedUntil = state.policy.mutedUntil;
  const muted = !!mutedUntil && Date.parse(mutedUntil) > now;
  useEffect(() => {
    if (!muted) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [muted, mutedUntil]);
  useEffect(() => {
    controller.setViewing(atBottom && !navigation.focus && !historyOpen && !avatarOpen && !peopleOpen
      && !preview && !moderating && !blocking && !newChatOpen && !profile);
    return () => controller.setViewing(false);
  }, [controller, atBottom, historyOpen, avatarOpen, peopleOpen, preview, moderating, blocking,
    navigation.focus, newChatOpen, profile]);
  useLayoutEffect(() => { if (atBottom && list.current) list.current.scrollTop = list.current.scrollHeight; },
    [state.messages, atBottom]);
  const scrollBottom = () => {
    navigation.clear(); setAtBottom(true); if (list.current) list.current.scrollTop = list.current.scrollHeight;
  };
  const signedOut = state.status === 'signed-out';
  return <section className="lounge-layout">
    <aside className="lounge-sidebar">
      <LoungePeople state={state} controller={controller} select={select} block={setBlocking} newChat={newChat}
        pin={(id, pinned) => controller.setPinned(id, pinned)} profile={showProfile} /></aside>
    <section className="lounge-page">
    <header className="lounge-heading"><div className="lounge-heading-title">
      <button className="lounge-people-toggle" type="button" aria-label={t('client.lounge.people')}
        onClick={() => setPeopleOpen(true)}><Users size={21} /></button>
      {contact ? <span role="img" aria-label={t(contactStatus(contact))}
        className={`lounge-peer-presence${state.status === 'connected' && contact.online === true ? ' is-online' : ''}`} />
        : <Coffee size={21} />}<h1>{contact ? accountName(contact.user) : t('client.lounge.title')}</h1></div>
      <div className="lounge-heading-actions"><span className={`lounge-connection is-${state.status}`} role="status">
        <i />{t(`client.lounge.${state.status}`)}</span>
        {state.policy.moderator && state.onlineCount !== undefined && <span className="lounge-online-count">
          {t('client.lounge.onlineCount', { count: state.onlineCount })}</span>}
        {!state.conversation && <LoungeAssistanceButton />}
      </div></header>
    <div className="lounge-conversation" ref={list} role="log" aria-live="off" aria-label={t('client.lounge.title')}
      onScroll={() => {
        const node = list.current;
        if (node) setAtBottom(!navigation.focus && node.scrollHeight - node.clientHeight - node.scrollTop < 48);
      }}>
      {!state.messages.length && <div className="lounge-empty"><Coffee size={40} />
        <h2>{t(signedOut ? 'client.lounge.signIn' : contact ? 'client.lounge.directEmpty' : 'client.lounge.empty')}</h2>
        <p>{t(contact ? 'client.lounge.directHint' : 'client.lounge.ephemeral')}</p>
        {signedOut && onLogin && <button type="button" onClick={onLogin}>{t('client.lounge.login')}</button>}
      </div>}
      {navigation.messages.map((message, index) => {
        const own = message.sender.id === state.user?.id;
        const previous = navigation.messages[index - 1];
        const showTime = !previous || Date.parse(message.sentAt) - Date.parse(previous.sentAt) > 5 * 60_000;
        return <div key={`${message.sender.id}:${message.id}`}>
          {showTime && <div className="lounge-time"><time dateTime={message.sentAt}>
            {new Intl.DateTimeFormat(localeForLanguage(language), { hour: '2-digit', minute: '2-digit' })
              .format(new Date(message.sentAt))}</time></div>}
          <article data-lounge-message-key={historyKey(message)}
            className={`lounge-message${own ? ' is-own' : ''}${navigation.highlight === historyKey(message)
              ? ' is-highlighted' : ''}`}>
            <LoungeAvatar user={message.sender}
              onProfile={state.conversation ? () => showProfile(message.sender) : undefined}
              onMention={!own ? () => composer.current?.mention(message.sender) : undefined}
              onDirect={!own && state.directAvailable ? () => select(message.sender) : undefined} />
            <div className="lounge-message-main">
              <LoungeSender user={message.sender} manage={state.policy.moderator && !own
                ? () => setModerating(message.sender) : undefined} />
              <LoungeMessageBody message={message} preview={setPreview} controller={controller} locate={locate}
                actions={{ reply: quote, blocked: state.blocked.includes(message.sender.id),
                  direct: !own && state.directAvailable ? () => select(message.sender) : undefined,
                  block: !own && state.directAvailable ? () => setBlocking(message.sender) : undefined }}
                onImageLoad={() => { if (atBottom && list.current) list.current.scrollTop = list.current.scrollHeight; }} />
            </div>
          </article>
        </div>;
      })}
    </div>
    {(!atBottom || navigation.focus) && <button className="lounge-jump" type="button" onClick={scrollBottom}>
      <ArrowDown size={15} />{t('client.lounge.latest')}{state.unread > 0 && ` · ${state.unread}`}</button>}
    {muted && <p className="lounge-mute-notice" role="status">{t('client.lounge.mutedUntil', {
      time: new Intl.DateTimeFormat(localeForLanguage(language), { dateStyle: 'short', timeStyle: 'short' })
        .format(new Date(mutedUntil!)),
    })}</p>}
    {!!state.conversation && state.status === 'connected' && !state.directAvailable
      && <p className="lounge-mute-notice" role="status">{t('client.lounge.directUpgrade')}</p>}
    {state.historyError && <p className="lounge-history-warning" role="alert">{t('client.lounge.historySaveFailed')}
      <button type="button" onClick={() => void controller.retryHistory()}>{t('client.lounge.historyRetry')}</button></p>}
    {state.contactsSyncError && <p className="lounge-history-warning" role="alert">
      {t('client.lounge.contactsSyncFailed')}
      <button type="button" onClick={() => controller.retryContacts()}>{t('client.lounge.historyRetry')}</button></p>}
    <LoungeSyncNotice failed={state.deviceSyncError} controller={controller} />
    {navigation.error && <p className="lounge-mute-notice" role="status">{t(navigation.error)}</p>}
    <LoungeComposer direct={!!state.conversation} filesAvailable={state.attachmentsAvailable}
      key={`${state.user?.id ?? 'guest'}:${state.conversation}`}
      composerRef={composer}
      assistance={contact && <LoungeAssistanceButton user={contact.user} />}
      connected={state.status === 'connected' && !muted && (!state.conversation || state.directAvailable)} mobile={mobile}
      reply={reply} cancelReply={sent => setReply(current => !sent || current === sent ? undefined : current)}
      send={draft => controller.send({ ...draft, to: state.conversation || undefined })}
      onHistory={() => setHistoryOpen(true)} />
    <LoungeHistory open={historyOpen} close={() => setHistoryOpen(false)} controller={controller}
      profile={state.conversation ? user => { setHistoryOpen(false); showProfile(user); } : undefined}
      mention={user => { setHistoryOpen(false); composer.current?.mention(user); }}
      preview={setPreview} reply={quote} direct={select} locate={locate} navigationError={navigation.error} />
    {avatarOpen && state.user && <LoungeAvatarSettings user={state.user} controller={controller}
      close={() => setAvatarOpen(false)} />}
    {moderating && state.policy.moderator && <LoungeModeration user={moderating} controller={controller}
      close={() => setModerating(undefined)} />}
    {preview && <LoungePreview key={preview} uri={preview} close={() => setPreview(undefined)} />}
    {blocking && <LoungeBlockDialog user={blocking} blocked={state.blocked.includes(blocking.id)}
      controller={controller} close={() => setBlocking(undefined)} />}
    {newChatOpen && <LoungeNewChat key={state.user?.id} controller={controller} state={state}
      select={select} close={() => setNewChatOpen(false)} />}
    {profile && <LoungeDesktopProfile user={profile} state={state} controller={controller}
      close={() => setProfile(undefined)} editAvatar={() => { setProfile(undefined); setAvatarOpen(true); }} />}
    <Drawer open={peopleOpen} width="min(320px, 100vw)" placement="left" title={t('client.lounge.people')}
      onClose={() => setPeopleOpen(false)} styles={{ body: { padding: 0 } }}>
      <LoungePeople state={state} controller={controller} select={select} block={setBlocking} newChat={newChat}
        pin={(id, pinned) => controller.setPinned(id, pinned)} profile={showProfile} />
    </Drawer>
    </section>
  </section>;
}
