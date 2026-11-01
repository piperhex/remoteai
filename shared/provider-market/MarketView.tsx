import { useMemo } from 'react';
import { Alert, Button, Input, Modal, Segmented, Space } from 'antd';
import type { Language } from '@remoteai/i18n';
import { marketText } from './i18n';
import type { MarketClient } from './types';
import { useMarket } from './useMarket';
import { MarketAddDialog } from './MarketAddDialog';
import { MarketEditor } from './MarketEditor';
import { PublicProviderImport } from './PublicProviderImport';
import { MarketFeed } from './MarketFeed';
import './market.css';

export function MarketView({ client, language, initialId, onClose }: {
  client: MarketClient; language: Language; initialId?: string; onClose: () => void;
}) {
  const t = useMemo(() => marketText(language), [language]);
  const market = useMarket(client, initialId);
  const error = market.error && <Alert type="error" showIcon message={t(market.error)} action={
    <Button onClick={market.retry} disabled={market.busy}>{t('market.retry')}</Button>} />;
  if (market.selected) return <MarketAddDialog key={`${market.selected.id}:${market.identity?.userId ?? ''}`}
    item={market.selected} t={t} busy={market.busy} error={error} onClose={() => market.setSelected(null)}
    onAdd={client.add ? market.add : undefined} mode={client.addition?.(market.identity)} />;
  return <Modal open title={t('market.title')} footer={null} width={1040}
    className="provider-market-modal" onCancel={onClose} closable={{ 'aria-label': t('market.close') }}>
    <div className="provider-market">
    <p>{t('market.intro')}</p>
    {error}
    {market.notice && <Alert type="success" showIcon message={t(market.notice)} />}
    {market.editor ? <MarketEditor key={market.editor === 'new' ? 'new' : market.editor.id}
      initial={market.editor === 'new' ? undefined : market.editor} t={t} busy={market.busy}
      onSave={market.save} onCancel={() => market.setEditor(null)} /> : <>
      <div className="pm-toolbar"><Segmented value={market.scope} disabled={market.busy}
        options={(['all', 'official', 'community', 'mine'] as const).map((value) => ({ value, label: t(`market.${value}`) }))}
        onChange={(value) => market.selectScope(value as typeof market.scope)} />
        <Space wrap><PublicProviderImport t={t} disabled={market.busy} select={market.setSelected}
          fail={() => market.setError('market.invalid')} />
          <Button type="primary" disabled={market.busy} onClick={() => market.identity
            ? market.setEditor('new') : market.setError('market.signIn')}>{t('market.publish')}</Button></Space></div>
      <Input.Search aria-label={t('market.search')} placeholder={t('market.search')}
        allowClear onSearch={market.find} maxLength={160} />
      <MarketFeed market={market} t={t} />
    </>}
  </div></Modal>;
}
