import { useId, useMemo, type CSSProperties } from 'react';
import { Alert, Button, Modal, theme } from 'antd';
import type { Language } from '@remoteai/i18n';
import { marketText } from './i18n';
import type { MarketClient } from './types';
import { useMarket } from './useMarket';
import { MarketAddDialog } from './MarketAddDialog';
import { MarketEditor, MarketEditorActions } from './MarketEditor';
import { MarketToolbar } from './MarketToolbar';
import { MarketFeed } from './MarketFeed';
import './market.css';

export function MarketView({ client, language, initialId, onClose }: {
  client: MarketClient; language: Language; initialId?: string; onClose: () => void;
}) {
  const t = useMemo(() => marketText(language), [language]);
  const { token } = theme.useToken();
  const editorFormId = useId();
  const market = useMarket(client, initialId);
  const error = market.error && <Alert type="error" showIcon message={t(market.error)} action={
    <Button onClick={market.retry} disabled={market.busy}>{t('market.retry')}</Button>} />;
  const feedback = <>{error}{market.notice && <Alert type="success" showIcon message={t(market.notice)} />}</>;
  if (market.selected) return <MarketAddDialog key={`${market.selected.id}:${market.identity?.userId ?? ''}`}
    item={market.selected} t={t} busy={market.busy} error={error} onClose={() => market.setSelected(null)}
    onAdd={client.add ? market.add : undefined} mode={client.addition?.(market.identity)} />;
  return <Modal open centered title={t('market.title')} width="85vw"
    footer={market.editor ? <MarketEditorActions formId={editorFormId} t={t} busy={market.busy}
      onCancel={() => market.setEditor(null)} /> : null}
    className={`provider-market-modal${market.editor ? '' : ' pm-catalog-modal'}`}
    style={{ '--pm-surface': token.colorBgElevated, '--pm-accent': token.colorPrimary } as CSSProperties}
    onCancel={onClose} closable={{ 'aria-label': t('market.close') }}>
    <div className={`provider-market${market.editor ? '' : ' pm-catalog'}`}>
    {market.editor ? <>{feedback}<MarketEditor key={market.editor === 'new' ? 'new' : market.editor.id}
      initial={market.editor === 'new' ? undefined : market.editor} t={t} busy={market.busy}
      externalFormId={editorFormId}
      onSave={market.save} onCancel={() => market.setEditor(null)} /></> : <>
      <MarketToolbar market={market} t={t} />
      <div className="pm-catalog-scroll">{feedback}<MarketFeed market={market} t={t} /></div>
    </>}
  </div></Modal>;
}
