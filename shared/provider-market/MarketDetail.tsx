import type { ReactNode } from 'react';
import { Tag } from 'antd';
import type { MarketText } from './i18n';
import type { MarketItem, MarketPrice } from './types';
import { ProviderWebsiteIcon } from './ProviderWebsiteIcon';

function Prices({ price, t }: { price: MarketPrice; t: MarketText }) {
  return <dl className="pm-prices">{(['input', 'output', 'cachedInput'] as const).map((key) =>
    <div key={key}><dt>{t(`market.${key}`)}</dt><dd>{price[key] === null
      ? <span className="pm-muted">{t('market.missingPrice')}</span> : String(price[key])}</dd></div>)}</dl>;
}
export function MarketDetailTitle({ item }: { item: MarketItem }) {
  return <span className="pm-detail-title">
    <span className="pm-provider-icon"><ProviderWebsiteIcon url={item.pageLink?.url || item.baseUrl} size={24} /></span>
    <span>{item.name}</span>
  </span>;
}

export function MarketDetail({ item, t, showTitle = true, showConnectionSettings = true, scriptControl }: {
  item: MarketItem; t: MarketText; showTitle?: boolean; showConnectionSettings?: boolean; scriptControl?: ReactNode;
}) {
  return <article className="pm-detail">
    {showTitle && <div className="pm-row"><h2><MarketDetailTitle item={item} /></h2>
      <Tag>{t(item.official ? 'market.official' : 'market.community')}</Tag></div>}
    {item.official && <p>{t('market.officialNote')}</p>}
    {item.description && <p className="pm-description">{item.description}</p>}
    {showConnectionSettings && <>
      <strong>{t('market.destination')}</strong><code className="pm-destination">{item.baseUrl}</code>
      {item.pageLink && <section className="pm-page-link">
        <strong>{t('market.pageSettings')}</strong><code className="pm-destination">{item.pageLink.url}</code>
        {item.pageLink.query && <p>{t('market.pageQuery')}: <code>{item.pageLink.query}</code></p>}
        {Object.keys(item.pageLink.headers).length > 0 && <>
          <strong>{t('market.pageHeaders')}</strong><pre>{JSON.stringify(item.pageLink.headers, null, 2)}</pre>
        </>}
      </section>}
    </>}
    <p>{t('market.unit', { currency: item.currency })}</p>
    {item.models.map((model) => <section className="pm-model" key={model.id}>
      <h3>{model.id} <small>{model.protocol}</small></h3>
      {model.tiers.map((tier) => <section className="pm-tier" key={tier.multiplier}>
        <h4>{tier.multiplier}×</h4><strong>{t('market.normal')}</strong><Prices price={tier} t={t} />
        <p>{t('market.longContextThreshold')}: {tier.longContextThreshold ?? t('market.missingPrice')}</p>
        <strong>{t('market.longContext')}</strong><Prices price={tier.longContext} t={t} />
      </section>)}
    </section>)}
    <p className="pm-muted">{t('market.pricesNote')}</p>
    {item.balanceQuery && <section className="pm-script-review">
      <h3>{t('market.balanceScript')}</h3><p>{t('market.scriptScope')}</p>
      <code className="pm-destination">{item.balanceQuery.url}</code>
      <p>{t('market.balanceAuth')}: {item.balanceQuery.auth}</p>
      <pre>{item.balanceQuery.script}</pre>
      {scriptControl}
    </section>}
  </article>;
}
