import { Button, Input, InputNumber, Select } from 'antd';
import type { ReactNode } from 'react';
import type { MarketText } from './i18n';
import { emptyTier, MARKET_PROTOCOLS, type MarketDraft, type MarketModel, type MarketTier } from './types';
import { PriceFields } from './PriceFields';

function ModelFields({ value, onChange, onRemove, t }: {
  value: MarketModel; onChange: (model: MarketModel) => void; onRemove?: () => void; t: MarketText;
}) {
  return <div className="pm-model-fields">
    <label><span>{t('market.model')}</span><Input value={value.id} maxLength={128}
      placeholder={t('market.modelPlaceholder')} aria-label={t('market.model')}
      onChange={(event) => onChange({ ...value, id: event.target.value })} /></label>
    <label><span>{t('market.protocol')}</span><Select value={value.protocol} aria-label={t('market.protocol')}
      options={MARKET_PROTOCOLS.map((protocol) => ({ value: protocol, label: protocol }))}
      onChange={(protocol) => onChange({ ...value, protocol })} /></label>
    <Button danger disabled={!onRemove} onClick={onRemove}>{t('market.removeModel')}</Button>
  </div>;
}

function TierEditor({ value, currency, onChange, onRemove, t, modelFields, addTier }: {
  value: MarketTier; currency: MarketDraft['currency']; onChange: (tier: MarketTier) => void;
  onRemove?: () => void; t: MarketText; modelFields?: ReactNode; addTier?: ReactNode;
}) {
  return <div className="pm-tier-editor">
    <section className="pm-editor-section">
      {modelFields && <><h4>{t('market.modelConfiguration')}</h4>{modelFields}</>}
      <div className="pm-multiplier-row">
        <label><span>{t('market.multiplier')}</span><InputNumber value={value.multiplier} min={0.001} max={1000}
          aria-label={t('market.multiplier')} onChange={(number) => onChange({ ...value, multiplier: number ?? 0 })} />
        </label>
        <Button danger disabled={!onRemove} onClick={onRemove}>{t('market.removeTier')}</Button>
      </div>
    </section>
    <section className="pm-editor-section">
      <h4>{t('market.normal')}</h4>
      <div className="pm-price-fields"><PriceFields value={value} currency={currency} t={t}
        onChange={(price) => onChange({ ...value, ...price })} /></div>
    </section>
    <section className="pm-editor-section">
      <h4>{t('market.longContext')}</h4>
      <div className="pm-long-context-fields">
        <label><span>{t('market.thresholdLabel')}</span>
          <div className="pm-threshold-input"><InputNumber value={value.longContextThreshold}
            min={1} max={1_000_000_000} precision={0} aria-label={t('market.longContextThreshold')}
            placeholder={t('market.missingPrice')}
            onChange={(number) => onChange({ ...value, longContextThreshold: number })} />
            <span>{t('market.tokenUnit')}</span></div>
        </label>
        <PriceFields value={value.longContext} currency={currency} t={t}
          onChange={(price) => onChange({ ...value, longContext: price })} />
        {addTier}
      </div>
    </section>
  </div>;
}

export function ModelEditor({ value, currency, onChange, onRemove, t }: {
  value: MarketModel; currency: MarketDraft['currency']; onChange: (model: MarketModel) => void;
  onRemove?: () => void; t: MarketText;
}) {
  const setTier = (index: number, tier: MarketModel['tiers'][number]) =>
    onChange({ ...value, tiers: value.tiers.map((item, position) => position === index ? tier : item) });
  const addTier = () => {
    let multiplier = 1;
    while (value.tiers.some((tier) => tier.multiplier === multiplier)) multiplier++;
    onChange({ ...value, tiers: [...value.tiers, emptyTier(multiplier)] });
  };
  return <section className="pm-model-editor">
    <svg className="pm-model-outline" aria-hidden="true" focusable="false"><rect x="1" y="1" rx="12" /></svg>
    {value.tiers.map((tier, index) => <TierEditor key={index} value={tier} currency={currency} t={t}
      onChange={(changed) => setTier(index, changed)}
      onRemove={value.tiers.length > 1 ? () => onChange({
        ...value, tiers: value.tiers.filter((_, position) => position !== index),
      }) : undefined}
      modelFields={index === 0 && <ModelFields value={value} onChange={onChange} onRemove={onRemove} t={t} />}
      addTier={index === value.tiers.length - 1 && <Button disabled={value.tiers.length >= 16}
        onClick={addTier}>{t('market.addTier')}</Button>} />)}
  </section>;
}
