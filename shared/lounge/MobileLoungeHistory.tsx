import { useMemo, useSyncExternalStore } from 'react';
import { Drawer } from 'antd';
import { ChevronLeft, Search } from 'lucide-react';
import VirtualList from 'rc-virtual-list';
import { displayText as t } from '../localization/messages';
import { getInterfaceLanguage } from '../localization/interfaceLanguage';
import { localeForLanguage } from '../localization/language';
import type { LoungeHistoryProps } from './LoungeHistory';
import { useHistoryTimeline, type HistoryTimelineModel } from './useHistoryTimeline';
import { historyTimelineRows } from './historyTimelineRows';
import { useHistoryVirtualList } from './useHistoryVirtualList';
import { MobileLoungeHistoryMessage } from './MobileLoungeHistoryMessage';
import './mobileHistory.css';

export function MobileLoungeHistory(props: LoungeHistoryProps) {
  const { controller, close, navigationError } = props;
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const history = useHistoryTimeline(controller);
  const locale = localeForLanguage(getInterfaceLanguage());
  const rows = useMemo(() => historyTimelineRows(history.messages, locale).reverse(), [history.messages, locale]);
  return <Drawer open placement="right" width="100%" title={t('client.lounge.history')} onClose={close}
    closable={false} rootClassName="lounge-mobile lounge-history-screen"
    styles={{ header: { display: 'none' }, body: { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}>
    <header className="lounge-history-heading">
      <button type="button" onClick={close}><ChevronLeft size={22} aria-hidden />{t('client.lounge.backToChat')}</button>
      <h1>{t('client.lounge.history')}</h1><span aria-hidden />
    </header>
    <label className="lounge-history-search-field"><Search size={21} aria-hidden />
      <input value={history.query} onChange={event => history.setQuery(event.target.value)}
        aria-label={t('client.lounge.searchHistory')} placeholder={t('client.lounge.searchHistory')} />
    </label>
    {navigationError && <p role="alert" className="lounge-history-status">{t(navigationError)}</p>}
    {history.error && rows.length > 0 && <HistoryStatus history={history} />}
    <HistoryList key={history.key} history={history} rows={rows} render={row =>
      <MobileLoungeHistoryMessage row={row} props={props} state={state} locale={locale} />} />
  </Drawer>;
}

type Rows = ReturnType<typeof historyTimelineRows>;
function HistoryList({ history, rows, render }: {
  history: HistoryTimelineModel; rows: Rows; render: (row: Rows[number]) => React.ReactNode;
}) {
  const virtual = useHistoryVirtualList(history, rows);
  return <div ref={virtual.viewport} className="lounge-history-viewport" aria-busy={!!history.loading}>
    {!rows.length && <HistoryStatus history={history} />}
    {rows.length > 0 && virtual.height > 0 && <VirtualList ref={virtual.list} data={rows} height={virtual.height}
      itemHeight={112} itemKey="key" fullHeight onVisibleChange={virtual.visible} onVirtualScroll={virtual.scrolled}
      innerProps={{ role: 'list' }}>
      {row => <div className="lounge-history-row" data-history-key={row.key} role="listitem"
        onLoadCapture={virtual.restore}>{render(row)}</div>}
    </VirtualList>}
    {history.loading && rows.length > 0 && <div className={`lounge-history-loading is-${history.loading}`} role="status">
      {t('client.lounge.historyLoading')}</div>}
  </div>;
}

function HistoryStatus({ history }: { history: HistoryTimelineModel }) {
  const label = history.error ? 'client.lounge.historyLoadFailed' : history.loading ? 'client.lounge.historyLoading'
    : history.query.trim() ? 'client.lounge.historyNoResults' : 'client.lounge.historyEmpty';
  return <div className="lounge-history-status" role={history.error ? 'alert' : 'status'}>
    <p>{t(label)}</p>
    {history.error && <button type="button" onClick={history.retry}>{t('client.lounge.historyRetry')}</button>}
  </div>;
}
