import { useCallback, useEffect, useRef, useState } from 'react';
import { marketError, type MarketKey } from './i18n';
import { publicDraft, type MarketClient, type MarketDraft, type MarketIdentity, type MarketItem,
  type MarketRequest } from './types';
import { parseItem } from './validation';
import { sameIdentity, useMarketFeed } from './useMarketFeed';

export { sameIdentity } from './useMarketFeed';

export function useMarket(client: MarketClient, initialId?: string) {
  const [identity, setIdentity] = useState<MarketIdentity | null>(null);
  const [selected, setSelected] = useState<MarketItem | null>(null);
  const [editor, setEditor] = useState<MarketItem | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MarketKey | null>(null);
  const [notice, setNotice] = useState<MarketKey | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const observedIdentity = useRef<MarketIdentity | null | undefined>(undefined);
  const observeIdentity = useCallback((current: MarketIdentity | null) => {
    if (observedIdentity.current !== undefined && !sameIdentity(observedIdentity.current, current)) {
      setEditor(null); setSelected(null);
    }
    observedIdentity.current = current;
    setIdentity(current);
  }, []);
  const feed = useMarketFeed(client, observeIdentity);
  const reload = useCallback(() => { setError(null); feed.reload(); }, [feed.reload]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  useEffect(() => {
    let active = true;
    if (initialId) void client.request({ type: 'get', id: initialId }, null)
      .then((value) => { if (active) setSelected(parseItem(value)); })
      .catch((reason) => { if (active) setError(marketError(reason)); });
    return () => { active = false; };
  }, [client, initialId]);
  const run = async (action: (current: MarketIdentity | null) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const current = await client.identity();
      if (!sameIdentity(identity, current)) {
        setIdentity(current); setEditor(null); reload(); throw new Error('market.signIn');
      }
      await action(current);
    } catch (reason) { if (mounted.current) setError(marketError(reason)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const write = async (request: MarketRequest) => run(async (current) => {
    if (!current) throw new Error('market.signIn');
    const reply = await client.request(request, current);
    if (!mounted.current) return;
    if (!sameIdentity(current, await client.identity())) throw new Error('market.signIn');
    const pending = 'reviewStatus' in reply && reply.reviewStatus === 'pending';
    setEditor(null); setSelected(null); setNotice(pending ? 'market.reviewSubmitted' : 'market.saved');
    if (pending) feed.selectScope('mine');
    reload();
  });
  const save = async (draft: MarketDraft, published: boolean) => write({ type: 'save', draft: publicDraft(draft),
    published, ...(editor && editor !== 'new' ? { id: editor.id, revision: editor.revision } : {}) });
  const add = async (item: MarketItem, key: string) => run(async (current) => {
    if (!client.add) return;
    const outcome = await client.add(item, key, current);
    if (mounted.current) { setSelected(null); setNotice(`market.${outcome}`); reload(); }
  });
  return { ...feed, identity, selected, editor, busy, error: error ?? feed.error, notice,
    reload, setSelected, setEditor, setError, save, add, write,
    retry: () => {
      if (error === 'market.conflict' || error === 'market.forbidden' || error === 'market.missing') {
        setEditor(null); setSelected(null);
      }
      reload();
    },
    selectScope: (value: typeof feed.scope) => { setError(null); feed.selectScope(value); },
    find: (value: string) => { setError(null); feed.find(value); },
  };
}
