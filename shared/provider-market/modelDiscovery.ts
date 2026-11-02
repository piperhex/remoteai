import { emptyModel, type MarketModel, type MarketProtocol } from './types';
import { publicUrl } from './validation';

export const MARKET_MODEL_LIMIT = 64;
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const DISCOVERY_TIMEOUT_MS = 15_000;
const MAX_DISCOVERY_PAGES = 20;

export interface ModelDiscoveryConnection {
  baseUrl: string;
  apiKey: string;
  protocol: MarketProtocol;
}
export type DiscoverMarketModels = (connection: ModelDiscoveryConnection) => Promise<string[]>;

export function mergeDiscoveredModels(current: MarketModel[], ids: string[], protocol: MarketProtocol) {
  const available = [...new Set(ids.map(id => id.trim()).filter(id => MODEL_ID.test(id)))];
  if (!available.length) throw new Error('market.modelsEmpty');
  // Only discard untouched placeholders; an unfinished row may already contain entered prices.
  const models = current.filter(model => JSON.stringify(model) !== JSON.stringify(emptyModel()));
  const existing = new Set(models.map(model => model.id.trim()));
  const additions = available.filter(id => !existing.has(id));
  const imported = additions.slice(0, Math.max(0, MARKET_MODEL_LIMIT - models.length));
  return {
    models: [...models, ...imported.map(id => ({ ...emptyModel(), id, protocol }))],
    added: imported.length,
    skipped: additions.length - imported.length,
  };
}

function discoveryUrl({ baseUrl, protocol }: ModelDiscoveryConnection) {
  if (!publicUrl(baseUrl)) throw new Error('market.modelsFetchFailed');
  const url = new URL(baseUrl);
  let root = url.pathname.replace(/\/+$/, '');
  if (!root) root = protocol === 'geminiGenerateContent' ? '/v1beta' : '/v1';
  if (protocol === 'geminiGenerateContent' && url.hostname === 'generativelanguage.googleapis.com') {
    root = root.replace(/\/openai$/, '');
  }
  url.pathname = root.endsWith('/models') ? root : `${root}/models`;
  return url;
}

function discoveryHeaders({ apiKey, protocol }: ModelDiscoveryConnection) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (protocol === 'anthropicMessages') headers['anthropic-version'] = '2023-06-01';
  const key = apiKey.trim();
  if (!key) return headers;
  if (protocol === 'anthropicMessages') headers['x-api-key'] = key;
  else if (protocol === 'geminiGenerateContent') headers['x-goog-api-key'] = key;
  else headers.Authorization = `Bearer ${key}`;
  return headers;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readPage(payload: Record<string, unknown>) {
  const data = payload.data ?? payload.models;
  if (!Array.isArray(data)) throw new Error('market.modelsFetchFailed');
  return data.flatMap(value => {
    const item = record(value);
    const methods = item.supportedGenerationMethods;
    if (Array.isArray(methods) && !methods.includes('generateContent')) return [];
    const id = item.id ?? item.name;
    return typeof id === 'string' ? [id.trim().replace(/^models\//, '')] : [];
  });
}

function nextCursor(payload: Record<string, unknown>, protocol: MarketProtocol): string | null {
  const next = protocol === 'geminiGenerateContent' ? payload.nextPageToken
    : protocol === 'anthropicMessages' && payload.has_more ? payload.last_id : null;
  if (next == null && !(protocol === 'anthropicMessages' && payload.has_more)) return null;
  if (typeof next !== 'string' || !next.trim()) throw new Error('market.modelsFetchFailed');
  return next;
}

/** Browser editors use the provider's public API; desktop editors inject the native discovery transport. */
export const discoverBrowserModels: DiscoverMarketModels = async connection => {
  const url = discoveryUrl(connection);
  const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_DISCOVERY_PAGES; page++) {
    const response = await fetch(url, { headers: discoveryHeaders(connection), signal,
      credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error('market.modelsFetchFailed');
    const payload = record(await response.json());
    ids.push(...readPage(payload));
    const next = nextCursor(payload, connection.protocol);
    if (next === null) return [...new Set(ids)];
    if (seen.has(next)) throw new Error('market.modelsFetchFailed');
    seen.add(next);
    url.searchParams.set(connection.protocol === 'geminiGenerateContent' ? 'pageToken' : 'after_id', next);
  }
  throw new Error('market.modelsFetchFailed');
};
