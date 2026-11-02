import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, ConfigProvider, Input, Select, Space } from 'antd';
import type { MarketText } from './i18n';
import { emptyDraft, emptyModel, publicDraft, type MarketDraft } from './types';
import { validDraft } from './validation';
import { ModelEditor } from './ModelEditor';
import { BalanceQueryEditor } from './BalanceQueryEditor';
import { PageLinkEditor } from './PageLinkEditor';
import { validPageLink } from './pageLink';
import { ModelDiscoveryFields } from './ModelDiscoveryFields';
import { MARKET_MODEL_LIMIT, type DiscoverMarketModels } from './modelDiscovery';
import './providerBrowser.css';

export function MarketEditorActions({ busy, t, onCancel, formId }: {
  busy: boolean; t: MarketText; onCancel: () => void; formId?: string;
}) {
  return <Space wrap><Button disabled={busy} onClick={onCancel} aria-label={t('market.cancel')}>
    {t('market.cancel')}</Button>
    <Button type="primary" htmlType="submit" form={formId} loading={busy} aria-label={t('market.publishAction')}>
      {t('market.publishAction')}</Button></Space>;
}

export function MarketEditor({ initial, busy, t, onSave, onCancel, externalFormId, requiresReview = true,
  discoverModels }: {
  initial?: MarketDraft; busy: boolean; t: MarketText;
  onSave: (draft: MarketDraft, published: boolean) => Promise<void>; onCancel: () => void;
  externalFormId?: string;
  requiresReview?: boolean;
  discoverModels?: DiscoverMarketModels;
}) {
  const [value, setValue] = useState(() => initial ? publicDraft(initial) : emptyDraft());
  const [published, setPublished] = useState(() => initial && 'published' in initial ? Boolean(initial.published) : true);
  const [attempted, setAttempted] = useState(false);
  const validationRef = useRef<HTMLDivElement>(null);
  const valid = validDraft(value) && (!published || validPageLink(value.pageLink));
  return <form id={externalFormId} className="pm-editor" onSubmit={(event) => {
    event.preventDefault(); setAttempted(true);
    if (!valid) {
      requestAnimationFrame(() => validationRef.current?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    if (!busy) void onSave(publicDraft(value), published);
  }}>
    <Alert type="info" showIcon message={t('market.publicNotice')} />
    {requiresReview && <Alert type="info" showIcon message={t('market.reviewNotice')} />}
    <ConfigProvider componentDisabled={busy}><fieldset disabled={busy}>
      <label><span>{t('market.name')}</span><Input value={value.name} maxLength={80}
        aria-label={t('market.name')} onChange={(event) => setValue({ ...value, name: event.target.value })} /></label>
      <ModelDiscoveryFields baseUrl={value.baseUrl} models={value.models} busy={busy} t={t}
        discover={discoverModels} onBaseUrlChange={baseUrl => setValue(current => ({ ...current, baseUrl }))}
        onModelsChange={models => setValue(current => ({ ...current, models }))} />
      <label><span>{t('market.description')}</span><Input.TextArea value={value.description} maxLength={4000}
        rows={3} aria-label={t('market.description')}
        onChange={(event) => setValue({ ...value, description: event.target.value })} /></label>
      <PageLinkEditor value={value.pageLink} t={t} onChange={(pageLink) => setValue({ ...value, pageLink })} />
      <div className="pm-row"><label><span>{t('market.currency')}</span><Select value={value.currency}
        aria-label={t('market.currency')} options={['USD', 'CNY', 'EUR', 'JPY'].map((currency) => ({ value: currency }))}
        onChange={(currency) => setValue({ ...value, currency })} /></label>
        <span>{t('market.unit', { currency: value.currency })}</span></div>
      <p>{t('market.independentPrices')}</p>
      {value.models.map((model, index) => <ModelEditor key={index} value={model} currency={value.currency} t={t}
        onChange={(changed) => setValue({ ...value, models: value.models.map((entry, position) =>
          position === index ? changed : entry) })}
        onRemove={value.models.length > 1 ? () => setValue({ ...value,
          models: value.models.filter((_, position) => position !== index) }) : undefined} />)}
      <Button disabled={value.models.length >= MARKET_MODEL_LIMIT} onClick={() => setValue({
        ...value, models: [...value.models, emptyModel()],
      })}>{t('market.addModel')}</Button>
      <BalanceQueryEditor value={value.balanceQuery ?? null} t={t}
        onChange={(balanceQuery) => setValue({ ...value, balanceQuery })} />
      <Checkbox checked={published} onChange={(event) => setPublished(event.target.checked)}>
        {t(requiresReview ? 'market.requestPublication' : 'market.published')}</Checkbox>
    </fieldset></ConfigProvider>
    {attempted && !valid && <div ref={validationRef}><Alert type="error"
      message={t(!validPageLink(value.pageLink) && published ? 'market.pageRequired' : 'market.invalid')} /></div>}
    {!externalFormId && <MarketEditorActions busy={busy} t={t} onCancel={onCancel} />}
  </form>;
}
