import { Drawer, Input } from 'antd';
import { Search, X } from 'lucide-react';
import { displayText as t } from '../localization/messages';
import type { LoungeHistoryProps } from './LoungeHistory';
import { useHistoryTimeline } from './useHistoryTimeline';
import { DesktopLoungeHistoryList } from './DesktopLoungeHistoryList';
import './desktopHistory.css';

export function DesktopLoungeHistory(props: LoungeHistoryProps) {
  const { controller, open, close, navigationError } = props;
  const history = useHistoryTimeline(controller, !open);
  return <Drawer open={open} title={t('client.lounge.history')} width="min(720px, 100vw)" onClose={close}
    className="lounge-history lounge-desktop-history" closeIcon={<X size={24} />} closable={{ placement: 'end' }}
    styles={{ body: { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}>
    <div className="lounge-history-search">
      <Input value={history.query} onChange={event => history.setQuery(event.target.value)} allowClear
        prefix={<Search size={21} aria-hidden />}
        aria-label={t('client.lounge.searchHistory')} placeholder={t('client.lounge.searchHistory')} />
      {navigationError && <p role="status">{t(navigationError)}</p>}
    </div>
    {open && <DesktopLoungeHistoryList key={history.key} history={history} props={props} />}
  </Drawer>;
}
