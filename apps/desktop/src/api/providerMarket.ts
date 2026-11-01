import { invoke, loadCloudAuthState } from './backend';
import type { Provider, ProviderInput } from '../types';
import type { MarketClient, MarketIdentity, MarketReply } from '../../../../shared/provider-market/types';
import { personalProviderFields } from '../../../../shared/provider-market/install';
import { sameIdentity } from '../../../../shared/provider-market/useMarket';

async function identity(): Promise<MarketIdentity | null> {
  const state = await loadCloudAuthState();
  return state.authenticated && state.userId && state.baseUrl
    ? { userId: state.userId, baseUrl: state.baseUrl } : null;
}

export function desktopProviderMarket(
  onSave: (input: ProviderInput, identity?: MarketIdentity | null) => Promise<Provider | null>,
): MarketClient {
  const request: MarketClient['request'] = (request, identity) =>
    invoke<MarketReply>('cloud_provider_market', { request, identity });
  return {
    identity, request,
    add: async (item, key, expected) => {
      if (!sameIdentity(await identity(), expected)) throw new Error('market.signIn');
      const saved = await onSave(personalProviderFields(item, key), expected);
      if (!saved) throw new Error('market.unavailable');
      // Normal Provider save already awaits enabled cloud sync. A failed usage report never retries the local save.
      if (item.id && expected && sameIdentity(expected, await identity())) {
        try { await request({ type: 'usage', id: item.id, providerId: saved.id }, expected); }
        catch { /* Usage is optional; the personal Provider was successfully saved. */ }
      }
      return 'added';
    },
  };
}
