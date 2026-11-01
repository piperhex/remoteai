import { MARKET_BADGE_TONES, MARKET_PROTOCOLS, type MarketDraft, type MarketItem,
  type MarketPrice, type MarketTier } from './types';
import { validPageLink } from './pageLink';

export function publicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 512 && /^https?:$/.test(url.protocol) && !url.username && !url.password
      && !value.includes('?') && !value.includes('#') && !/[\\\s]/.test(value)
      && /^(\/[a-zA-Z0-9._-]{1,32})*\/?$/.test(url.pathname) && !value.includes('..');
  } catch { return false; }
}
const validPrice = (price: MarketPrice) => [price.input, price.output, price.cachedInput]
  .every((value) => value === null || (typeof value === 'number' && Number.isFinite(value)
    && value >= 0 && value <= 1e12));
function validTier(tier: MarketTier): boolean {
  if (!Number.isFinite(tier.multiplier) || tier.multiplier <= 0 || tier.multiplier > 1000
    || !validPrice(tier) || !validPrice(tier.longContext)) return false;
  if (tier.longContextThreshold === null) {
    return Object.values(tier.longContext).every((price) => price === null);
  }
  return Number.isInteger(tier.longContextThreshold) && tier.longContextThreshold > 0
    && tier.longContextThreshold <= 1_000_000_000;
}
export function validDraft(value: MarketDraft): boolean {
  if (value.pageLink != null && !validPageLink(value.pageLink)) return false;
  if (!value.name.trim() || value.name.length > 80 || value.description.length > 4000
    || !publicUrl(value.baseUrl) || !['USD', 'CNY', 'EUR', 'JPY'].includes(value.currency)
    || value.unit !== 'millionTokens' || value.models.length < 1 || value.models.length > 64) return false;
  if (value.balanceQuery) {
    const query = value.balanceQuery;
    if (!publicUrl(query.url) || !query.script || new TextEncoder().encode(query.script).length > 16 * 1024
      || !['bearer', 'x-api-key', 'none'].includes(query.auth) || !query.url.startsWith('https://')
      || new URL(query.url).origin !== new URL(value.baseUrl).origin) return false;
  }
  return new Set(value.models.map((model) => model.id)).size === value.models.length
    && value.models.every((model) => /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model.id)
      && MARKET_PROTOCOLS.includes(model.protocol) && model.tiers.length >= 1 && model.tiers.length <= 16
      && new Set(model.tiers.map((tier) => tier.multiplier)).size === model.tiers.length
      && model.tiers.every(validTier));
}
export function parseItem(value: unknown): MarketItem {
  if (!value || typeof value !== 'object') throw new Error('market.unavailable');
  const item = value as MarketItem;
  try {
    if (item.reviewStatus !== undefined && !['draft', 'pending', 'approved', 'rejected'].includes(item.reviewStatus)) {
      throw new Error('market.unavailable');
    }
    if (item.reviewReason !== undefined && typeof item.reviewReason !== 'string') throw new Error('market.unavailable');
    if (item.marketingBadge && (typeof item.marketingBadge.text !== 'string'
      || [...item.marketingBadge.text].length > 24 || !MARKET_BADGE_TONES.includes(item.marketingBadge.tone))) {
      throw new Error('market.unavailable');
    }
    if (typeof item.id === 'string' && typeof item.official === 'boolean'
      && typeof item.published === 'boolean' && Number.isInteger(item.revision) && item.revision > 0
      && Number.isInteger(item.userCount) && item.userCount >= 0 && validDraft(item)) return item;
  } catch { /* Malformed responses never reach installation. */ }
  throw new Error('market.unavailable');
}
