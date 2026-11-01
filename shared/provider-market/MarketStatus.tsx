import { Tag } from 'antd';
import type { MarketText } from './i18n';
import { MARKET_BADGE_TONES, type MarketBadge, type MarketItem } from './types';

export function MarketBadgeTag({ badge }: { badge?: MarketBadge | null }) {
  if (!badge?.text || !MARKET_BADGE_TONES.includes(badge.tone)) return null;
  return <Tag className="pm-marketing-badge" color={badge.tone}>{badge.text}</Tag>;
}

export function MarketStatus({ item, t }: { item: MarketItem; t: MarketText }) {
  if (!item.published) return <Tag className="pm-publication-status">{t('market.unpublished')}</Tag>;
  if (item.reviewStatus === 'pending') return <Tag className="pm-publication-status" color="gold">
    {t('market.reviewPending')}</Tag>;
  if (item.reviewStatus === 'rejected') return <Tag className="pm-publication-status" color="red">
    {t('market.reviewRejected')}</Tag>;
  return <Tag className="pm-publication-status" color="green">{t('market.published')}</Tag>;
}
