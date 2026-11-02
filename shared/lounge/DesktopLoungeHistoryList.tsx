import { useMemo, useSyncExternalStore } from 'react';
import { Button, Spin } from 'antd';
import VirtualList from 'rc-virtual-list';
import { displayText as t } from '../localization/messages';
import { getInterfaceLanguage } from '../localization/interfaceLanguage';
import { localeForLanguage } from '../localization/language';
import type { LoungeHistoryProps } from './LoungeHistory';
import type { HistoryTimelineModel } from './useHistoryTimeline';
import type { LoungeMessage, LoungeSnapshot } from './types';
import { historyKey } from './archive';
import { useHistoryVirtualList } from './useHistoryVirtualList';
import { LoungeAvatar } from './LoungeAvatar';
import { LoungeSender } from './LoungeSender';
import { LoungeMessageBody } from './LoungeMessageBody';

export function DesktopLoungeHistoryList({ history, props }: {
  history: HistoryTimelineModel; props: LoungeHistoryProps;
}) {
  const state = useSyncExternalStore(props.controller.subscribe, props.controller.snapshot);
  const rows = useMemo(() => history.messages.map(message => ({ key: historyKey(message), message })), [history.messages]);
  const virtual = useHistoryVirtualList(history, rows, true);
  const format = new Intl.DateTimeFormat(localeForLanguage(getInterfaceLanguage()), {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return <>
    <div ref={virtual.viewport} className="lounge-history-list" aria-busy={!!history.loading}>
      {rows.length > 0 && virtual.height > 0 && <VirtualList ref={virtual.list} data={rows} height={virtual.height}
        itemHeight={132} itemKey="key" fullHeight onVisibleChange={virtual.visible} onVirtualScroll={virtual.scrolled}
        innerProps={{ role: 'list' }}>
        {row => <div className="lounge-desktop-history-row" role="listitem" data-history-key={row.key}
          onLoadCapture={virtual.restore}>
          <HistoryMessage message={row.message} state={state} props={props} format={format} />
        </div>}
      </VirtualList>}
      {!rows.length && !history.loading && !history.error && <p className="lounge-history-empty" role="status">
        {t(history.query.trim() ? 'client.lounge.historyNoResults' : 'client.lounge.historyEmpty')}</p>}
    </div>
    {(history.loading || history.error) && <div className="lounge-history-load-state"
      role={history.error ? 'alert' : 'status'}>
      {history.error ? <><span>{t('client.lounge.historyLoadFailed')}</span>
        <Button type="link" onClick={history.retry}>{t('client.lounge.historyRetry')}</Button></>
        : <><Spin size="small" /><span>{t(rows.length ? 'client.chat.loadMore' : 'client.mobile.loading')}</span></>}
    </div>}
  </>;
}

function HistoryMessage({ message, state, props, format }: {
  message: LoungeMessage; state: LoungeSnapshot; props: LoungeHistoryProps; format: Intl.DateTimeFormat;
}) {
  const { close, direct, profile, mention, preview, reply, controller, locate } = props;
  const own = message.sender.id === state.user?.id;
  const startDirect = state.directAvailable && !own ? () => { close(); direct(message.sender); } : undefined;
  return <article className="lounge-history-message">
    <LoungeAvatar user={message.sender} onDirect={startDirect}
      onMention={!own && mention ? () => mention(message.sender) : undefined}
      onProfile={profile ? () => profile(message.sender) : undefined} />
    <div className="lounge-history-message-main">
      <header className="lounge-history-message-heading"><LoungeSender user={message.sender} />
        <time dateTime={message.sentAt}>{format.format(new Date(message.sentAt))}</time></header>
      <LoungeMessageBody message={message} preview={preview} actions={{ reply, direct: startDirect }}
        controller={controller} locate={locate} />
    </div>
  </article>;
}
