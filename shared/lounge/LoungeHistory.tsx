import { LoungeSender } from './LoungeSender';
import { useSyncExternalStore } from 'react';
import { Button, Drawer, Input } from 'antd';
import { Search } from 'lucide-react';
import { displayText as t } from '../localization/messages';
import { getInterfaceLanguage } from '../localization/interfaceLanguage';
import { localeForLanguage } from '../localization/language';
import { LoungeAvatar } from './LoungeAvatar';
import { LoungeMessageBody } from './LoungeMessageBody';
import { useLoungeHistory } from './useLoungeHistory';
import type { LoungeController } from './controller';
import type { LoungeAccount, LoungeMessage } from './types';
import type { LoungeReply } from './reply';
import { MobileLoungeHistory } from './MobileLoungeHistory';

export type LoungeHistoryProps = Parameters<typeof DesktopLoungeHistory>[0];

export function LoungeHistory(props: LoungeHistoryProps) {
  if (props.mobile) return props.open ? <MobileLoungeHistory {...props} /> : null;
  return <DesktopLoungeHistory {...props} />;
}

function DesktopLoungeHistory({ controller, open, close, preview, reply, direct, profile, mention, locate,
  navigationError, mobile = false }: {
  controller: LoungeController; open: boolean; close: () => void; preview: (source: string) => void;
  reply: (message: LoungeMessage) => void; direct: (user: LoungeAccount) => void;
  profile?: (user: LoungeAccount) => void;
  mention?: (user: LoungeAccount) => void;
  mobile?: boolean;
  locate?: (reference: LoungeReply) => void; navigationError?: string;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const history = useLoungeHistory(controller, open);
  const format = new Intl.DateTimeFormat(localeForLanguage(getInterfaceLanguage()), {
    dateStyle: 'short', timeStyle: 'short',
  });
  return <Drawer open={open} title={t('client.lounge.history')} width="min(560px, 100vw)" onClose={close}
    className="lounge-history" styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}>
    <div className="lounge-history-search">
      <Input value={history.query} onChange={event => history.setQuery(event.target.value)} allowClear
        prefix={<Search size={17} />}
        aria-label={t('client.lounge.searchHistory')} placeholder={t('client.lounge.searchHistory')} />
      <p>{t('client.lounge.historyHint')}</p>
      <span role="status">{history.loading ? t('client.lounge.historyLoading')
        : t('client.lounge.historyCount', { count: history.messages.length })}</span>
      {history.error && <p role="alert">{t('client.lounge.historyLoadFailed')}
        <Button type="link" onClick={history.retry}>{t('client.lounge.historyRetry')}</Button></p>}
      {navigationError && <p role="status">{t(navigationError)}</p>}
    </div>
    <div className="lounge-history-list">
      {!history.loading && !history.error && !history.messages.length && <p className="lounge-history-empty">
        {t(history.query.trim()
        ? 'client.lounge.historyNoResults' : 'client.lounge.historyEmpty')}</p>}
      {history.messages.map(message => {
        const startDirect = state.directAvailable && message.sender.id !== state.user?.id
          ? () => { close(); direct(message.sender); } : undefined;
        return <article key={`${message.sender.id}:${message.id}`}
          className="lounge-history-message">
          <LoungeAvatar user={message.sender} onDirect={startDirect}
            onMention={!mobile && mention && message.sender.id !== state.user?.id
              ? () => mention(message.sender) : undefined}
            onLongPress={mobile && mention && message.sender.id !== state.user?.id
              ? () => mention(message.sender) : undefined}
            onProfile={profile ? () => profile(message.sender) : undefined} />
          <div className="lounge-history-message-main"><LoungeSender user={message.sender} />
            <time dateTime={message.sentAt}>{format.format(new Date(message.sentAt))}</time>
            <LoungeMessageBody mobile={mobile} message={message} preview={preview} actions={{ reply, direct: startDirect }}
              controller={controller} locate={locate} />
          </div>
        </article>;
      })}
    </div>
    <nav className="lounge-history-pagination" aria-label={t('client.lounge.history')}>
      <Button onClick={history.previous} disabled={history.loading || !history.hasPrevious}>
        {t('client.lounge.historyPrevious')}</Button>
      <Button onClick={history.next} disabled={history.loading || !history.hasNext}>
        {t('client.lounge.historyNext')}</Button>
    </nav>
  </Drawer>;
}
