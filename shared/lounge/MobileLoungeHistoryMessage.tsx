import type { LoungeSnapshot } from './types';
import type { LoungeHistoryProps } from './LoungeHistory';
import type { HistoryTimelineRow } from './historyTimelineRows';
import { LoungeAvatar } from './LoungeAvatar';
import { LoungeSender } from './LoungeSender';
import { LoungeMessageBody } from './LoungeMessageBody';
import { LoungeDeliveryStatus } from './LoungeDeliveryStatus';

export function MobileLoungeHistoryMessage({ row, props, state, locale }: {
  row: HistoryTimelineRow; props: LoungeHistoryProps; state: LoungeSnapshot; locale: string;
}) {
  const { message, date } = row;
  const { close, direct, profile, mention, controller, locate, reply, preview } = props;
  const own = message.sender.id === state.user?.id;
  const startDirect = state.directAvailable && !own ? () => { close(); direct(message.sender); } : undefined;
  return <>
    {date && <div className="lounge-history-date"><span>{date}</span></div>}
    <article className={`lounge-history-message lounge-message${own ? ' is-own' : ''}`}>
      <LoungeAvatar user={message.sender} onDirect={startDirect}
        onProfile={profile ? () => profile(message.sender) : undefined}
        onLongPress={!own && mention ? () => mention(message.sender) : undefined} />
      <div className="lounge-message-main">
        <LoungeSender user={message.sender} />
        <LoungeMessageBody mobile showDelivery={false} message={message} preview={preview}
          controller={controller} locate={locate} actions={{ reply, direct: startDirect }} />
        <footer className="lounge-history-message-footer">
          <time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleTimeString(locale,
            { hour: '2-digit', minute: '2-digit' })}</time>
          <LoungeDeliveryStatus delivery={message.delivery} />
        </footer>
      </div>
    </article>
  </>;
}
