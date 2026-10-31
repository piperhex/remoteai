import { LoungeSender } from './LoungeSender';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { MessagesSquare } from 'lucide-react';
import { displayText as t } from '../localization/messages';
import type { MobileLounge } from './useMobileLounge';
import { LoungeAvatar } from './LoungeAvatar';
import { LoungeMessageBody } from './LoungeMessageBody';
import type { LoungeController } from './controller';
import { historyKey } from './archive';
import { scrollToLoungeMessage } from './scrollToMessage';
import type { LoungeAccount } from './types';

export function MobileLoungeThread({ model, controller, mention }: {
  model: MobileLounge; controller: LoungeController; mention: (user: LoungeAccount) => void;
}) {
  const { state, scrollPositions, following, updateScrollPosition } = model;
  const list = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const { focus, messages, highlight } = model.navigation;
  const updatePosition = useCallback(() => {
    const node = list.current;
    if (!node) return;
    scrollPositions.current.set(state.conversation, node.scrollTop);
    updateScrollPosition(node.scrollHeight - node.clientHeight - node.scrollTop, node.clientHeight);
  }, [scrollPositions, state.conversation, updateScrollPosition]);
  const scrollBottom = useCallback(() => {
    if (focus && highlight) { scrollToLoungeMessage(list.current, focus.key); return; }
    if (following && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [following, focus, highlight]);
  useLayoutEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => scrollToLoungeMessage(list.current, focus.key));
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node || focus) return;
    const position = scrollPositions.current.get(state.conversation) ?? 0;
    // Restore before paint so receipt updates cannot discard a reader's next scroll event.
    node.scrollTop = following ? node.scrollHeight : position;
    updatePosition();
  }, [state.conversation, messages, following, scrollPositions, focus, updatePosition]);
  useLayoutEffect(() => {
    if (!list.current || !content.current) return;
    const observer = new ResizeObserver(() => { scrollBottom(); updatePosition(); });
    observer.observe(list.current);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [scrollBottom, updatePosition]);
  return <div ref={list} className="lounge-conversation" role="log" aria-live="off"
    aria-label={t('client.lounge.title')} onScroll={updatePosition}>
    <div ref={content} className="lounge-mobile-messages">
      {!messages.length && <div className="lounge-empty">
        <span className="lounge-empty-symbol"><MessagesSquare size={27} /></span>
        <h2>{t(model.contact ? 'client.lounge.directEmpty' : 'client.lounge.empty')}</h2>
        <p>{t('client.lounge.emptyHint')}</p>
        <button type="button" className="lounge-greeting" onClick={() => model.draftState.change({
          ...model.draftState.draft, text: t(model.contact ? 'client.lounge.directGreeting' : 'client.lounge.greeting'),
        })}>{t(model.contact ? 'client.lounge.directGreeting' : 'client.lounge.greeting')}</button>
      </div>}
      {messages.map(message => {
        const own = message.sender.id === state.user?.id;
        return <article key={historyKey(message)} data-lounge-message-key={historyKey(message)}
          className={`lounge-message${own ? ' is-own' : ''}${highlight === historyKey(message) ? ' is-highlighted' : ''}`}>
          <LoungeAvatar user={message.sender} onProfile={() => model.setProfile(message.sender)}
            onLongPress={!own ? () => mention(message.sender) : undefined} />
          <div className="lounge-message-main">
            <LoungeSender user={message.sender} manage={state.policy.moderator && !own
              ? () => model.setModerating(message.sender) : undefined} />
            <LoungeMessageBody mobile message={message} preview={model.setPreview} onImageLoad={scrollBottom}
              controller={controller} locate={model.locate}
              actions={{ reply: model.quote, blocked: state.blocked.includes(message.sender.id),
                direct: !own && state.directAvailable ? () => model.select(message.sender) : undefined,
                block: !own && state.directAvailable ? () => model.setBlocking(message.sender) : undefined }} />
            <time className="lounge-message-time" dateTime={message.sentAt}>
              {new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
        </article>;
      })}
    </div>
  </div>;
}
