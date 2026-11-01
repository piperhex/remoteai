import { Space, Tag } from 'antd';
import type { MarketText } from './i18n';
import type { MarketItem, MarketRequest } from './types';
import { ProviderWebsiteIcon } from './ProviderWebsiteIcon';
import { MarketCardActions } from './MarketCardActions';
import { MarketBadgeTag, MarketStatus } from './MarketStatus';

export function MarketCard({ item, owned, busy, t, onSelect, onEdit, onWrite }: {
  item: MarketItem; owned: boolean; busy: boolean; t: MarketText;
  onSelect: (item: MarketItem) => void; onEdit: (item: MarketItem) => void;
  onWrite: (request: MarketRequest) => Promise<void>;
}) {
  return <article className="pm-card">
    <div className="pm-card-header">
      <button type="button" className="pm-card-title" disabled={busy} onClick={() => onSelect(item)}>
        <span className="pm-provider-icon"><ProviderWebsiteIcon url={item.pageLink?.url || item.baseUrl} /></span>
        <span>{item.name}</span>
      </button>
      <div className="pm-card-tools"><MarketBadgeTag badge={item.marketingBadge} />
        {owned && <MarketCardActions item={item} busy={busy} t={t} onEdit={onEdit} onWrite={onWrite} />}</div>
    </div>
    <Space wrap><Tag>{t(item.official ? 'market.official' : 'market.community')}</Tag>
      {owned && <MarketStatus item={item} t={t} />}
      <span>{t('market.users', { count: item.userCount })}</span></Space>
    {owned && item.reviewStatus === 'rejected' && item.reviewReason &&
      <p className="pm-review-reason">{t('market.reviewReasonValue', { reason: item.reviewReason })}</p>}
    <p>{item.description}</p><code>{new URL(item.baseUrl).host}</code>
    <p>{item.models.map((model) => model.id).join(' · ')}</p>
  </article>;
}
