import { copyPageLink, type MarketPageLink } from './pageLink';

export const MARKET_PROTOCOLS = [
  'openaiResponses', 'openaiChat', 'anthropicMessages', 'geminiGenerateContent',
] as const;
export type MarketProtocol = typeof MARKET_PROTOCOLS[number];

export interface MarketPrice {
  input: number | null;
  output: number | null;
  cachedInput: number | null;
}
export interface MarketTier extends MarketPrice {
  multiplier: number;
  longContextThreshold: number | null;
  longContext: MarketPrice;
}
export interface MarketModel {
  id: string;
  protocol: MarketProtocol;
  tiers: MarketTier[];
}
export interface MarketBalanceQuery {
  url: string;
  auth: 'bearer' | 'x-api-key' | 'none';
  script: string;
}
/** Public allowlist: never derive this object by spreading a personal Provider. */
export interface MarketDraft {
  name: string;
  description: string;
  baseUrl: string;
  currency: 'USD' | 'CNY' | 'EUR' | 'JPY';
  unit: 'millionTokens';
  models: MarketModel[];
  balanceQuery?: MarketBalanceQuery | null;
  pageLink?: MarketPageLink | null;
}
export interface MarketItem extends MarketDraft {
  id: string;
  ownerId: string | null;
  official: boolean;
  published: boolean;
  revision: number;
  userCount: number;
  sortOrder: number | null;
  reviewStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  reviewReason?: string;
  marketingBadge?: MarketBadge | null;
}
export const MARKET_BADGE_TONES = ['blue', 'green', 'orange', 'red', 'purple'] as const;
export interface MarketBadge { text: string; tone: typeof MARKET_BADGE_TONES[number] }
export interface MarketIdentity { userId: string; baseUrl: string }
export interface MarketPage { items: MarketItem[]; total: number }
export type MarketRequest =
  | { type: 'list'; scope: 'all' | 'official' | 'community' | 'mine'; search: string; page: number }
  | { type: 'get'; id: string }
  | { type: 'save'; id?: string; revision?: number; published: boolean; draft: MarketDraft }
  | { type: 'remove'; id: string; revision: number }
  | { type: 'usage'; id: string; providerId: string };
export type MarketReply = MarketPage | MarketItem | { ok: boolean; counted?: boolean };
export interface MarketClient {
  discoverModels?: import('./modelDiscovery').DiscoverMarketModels;
  identity: () => Promise<MarketIdentity | null>;
  request: (request: MarketRequest, identity: MarketIdentity | null) => Promise<MarketReply>;
  add?: (item: MarketItem, apiKey: string, identity: MarketIdentity | null) => Promise<'added' | 'downloaded'>;
  addition?: (identity: MarketIdentity | null) => 'local' | 'cloud' | 'download';
}
export const emptyPrice = (): MarketPrice => ({ input: null, output: null, cachedInput: null });
export const emptyTier = (multiplier = 1): MarketTier => ({
  multiplier, ...emptyPrice(), longContextThreshold: null, longContext: emptyPrice(),
});
export const emptyModel = (): MarketModel => ({ id: '', protocol: 'openaiResponses', tiers: [emptyTier()] });
export const emptyDraft = (): MarketDraft => ({
  name: '', description: '', baseUrl: '', currency: 'USD', unit: 'millionTokens', models: [emptyModel()],
});
export function publicDraft(item: MarketDraft): MarketDraft {
  return {
    name: item.name, description: item.description, baseUrl: item.baseUrl, currency: item.currency,
    pageLink: item.pageLink ? copyPageLink(item.pageLink) : null,
    balanceQuery: item.balanceQuery ? {
      url: item.balanceQuery.url, auth: item.balanceQuery.auth, script: item.balanceQuery.script,
    } : null,
    unit: 'millionTokens', models: item.models.map((model) => ({
      id: model.id, protocol: model.protocol, tiers: model.tiers.map((tier) => ({
        multiplier: tier.multiplier, input: tier.input, output: tier.output, cachedInput: tier.cachedInput,
        longContextThreshold: tier.longContextThreshold, longContext: {
          input: tier.longContext.input, output: tier.longContext.output, cachedInput: tier.longContext.cachedInput,
        },
      })),
    })),
  };
}
