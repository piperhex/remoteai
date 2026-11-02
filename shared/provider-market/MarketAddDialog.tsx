import { useId, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Tag } from 'antd';
import { Globe } from 'lucide-react';
import type { MarketText } from './i18n';
import type { MarketItem } from './types';
import { MarketDetail, MarketDetailTitle } from './MarketDetail';
import { validPageLink } from './pageLink';

export function MarketAddDialog({ item, t, busy, error, mode = 'local', onAdd, onOpenPage, onClose }: {
  item: MarketItem; t: MarketText; busy: boolean; error: ReactNode; mode?: 'local' | 'cloud' | 'download';
  onAdd?: (item: MarketItem, key: string) => Promise<void>; onClose: () => void;
  onOpenPage?: (item: MarketItem) => void;
}) {
  const apiKeyId = useId();
  const [apiKey, setApiKey] = useState('');
  const [scriptEnabled, setScriptEnabled] = useState(false);
  const addButton = onAdd && <Button type="primary" loading={busy} disabled={mode !== 'download' && !apiKey.trim()}
    onClick={() => void onAdd({ ...item, balanceQuery: mode === 'download' || scriptEnabled
      ? item.balanceQuery : null }, apiKey.trim())}>
    {t(mode === 'download' ? 'market.webAnonymousAdd' : 'market.add')}</Button>;
  return <Modal open title={<div className="pm-row"><MarketDetailTitle item={item} />
    <Tag>{t(item.official ? 'market.official' : 'market.community')}</Tag></div>}
    width="85vw" centered className="provider-market-modal pm-add-modal" footer={addButton ?? null}
    onCancel={onClose} keyboard={!busy} maskClosable={!busy}
    closable={{ disabled: busy, 'aria-label': t('market.close') }}>
    <div className="provider-market">
      {onAdd && <section className="pm-install">
        {mode !== 'download' && <div className="pm-api-key">
          <div className="pm-api-key-heading"><label htmlFor={apiKeyId}>{t('market.ownKey')}</label>
            {onOpenPage && validPageLink(item.pageLink) && <Button type="link" size="small"
              icon={<Globe size={14} aria-hidden="true" />} disabled={busy}
              onClick={() => onOpenPage(item)}>{t('market.visitHomepage')}</Button>}
          </div>
          <Input.Password id={apiKeyId} autoFocus value={apiKey} disabled={busy} autoComplete="new-password"
            aria-label={t('market.ownKey')} onChange={event => setApiKey(event.target.value)} /></div>}
        <Alert type="info" message={t(mode === 'download' ? 'market.webAnonymousInfo' : 'market.addInfo')} />
        {mode === 'cloud' && <p>{t('market.webAddInfo')}</p>}
      </section>}
      {error}
      <MarketDetail item={item} t={t} showTitle={false} showConnectionSettings={false}
        scriptControl={onAdd && mode !== 'download'
        ? <Checkbox checked={scriptEnabled} disabled={busy}
          onChange={event => setScriptEnabled(event.target.checked)}>{t('market.enableScript')}</Checkbox> : null} />
    </div>
  </Modal>;
}
