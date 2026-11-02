import { useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from 'antd';
import { Download } from 'lucide-react';
import type { MarketKey, MarketText } from './i18n';
import { MARKET_PROTOCOLS, type MarketModel, type MarketProtocol } from './types';
import { publicUrl } from './validation';
import { discoverBrowserModels, mergeDiscoveredModels, type DiscoverMarketModels } from './modelDiscovery';

export function ModelDiscoveryFields({ baseUrl, models, busy, t, onBaseUrlChange, onModelsChange,
  discover = discoverBrowserModels }: {
  baseUrl: string; models: MarketModel[]; busy: boolean; t: MarketText;
  onBaseUrlChange: (value: string) => void; onModelsChange: (models: MarketModel[]) => void;
  discover?: DiscoverMarketModels;
}) {
  const [apiKey, setApiKey] = useState('');
  const [protocol, setProtocol] = useState<MarketProtocol>('openaiResponses');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ key: MarketKey; count?: number; error?: boolean } | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const latest = useRef({ models, busy, baseUrl, apiKey, protocol, onModelsChange });
  latest.current = { models, busy, baseUrl, apiKey, protocol, onModelsChange };
  useEffect(() => {
    generation.current++;
    setNotice(null);
    return () => { generation.current++; };
  }, [baseUrl, apiKey, protocol, busy]);

  const load = async () => {
    if (busy || pending.current || !publicUrl(baseUrl)) return;
    const request = generation.current;
    pending.current = true;
    setLoading(true); setNotice(null);
    const current = () => request === generation.current && !latest.current.busy
      && baseUrl === latest.current.baseUrl && apiKey === latest.current.apiKey && protocol === latest.current.protocol;
    try {
      const ids = await discover({ baseUrl, apiKey, protocol });
      if (!current()) return;
      const result = mergeDiscoveredModels(latest.current.models, ids, protocol);
      latest.current.onModelsChange(result.models);
      setNotice({ key: result.skipped ? 'market.modelsLimit' : 'market.modelsImported', count: result.added });
    } catch (error) {
      if (current()) setNotice({ key: error instanceof Error && error.message === 'market.modelsEmpty'
        ? 'market.modelsEmpty' : 'market.modelsFetchFailed', error: true });
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };

  return <div className="pm-model-discovery">
    <div className="pm-service-row">
      <label><span>{t('market.baseUrl')}</span><Input value={baseUrl} aria-label={t('market.baseUrl')}
        onChange={event => onBaseUrlChange(event.target.value.trim())} /></label>
      <Button loading={loading} disabled={busy || !publicUrl(baseUrl)} icon={<Download size={14} />}
        onClick={() => void load()}>{t('market.fetchModels')}</Button>
    </div>
    <details><summary>{t('market.discoveryOptions')}</summary>
      <div className="pm-row pm-discovery-options">
        <label><span>{t('market.discoveryKey')}</span><Input.Password value={apiKey} autoComplete="off"
          aria-label={t('market.discoveryKey')} onChange={event => setApiKey(event.target.value)} /></label>
        <label><span>{t('market.discoveryProtocol')}</span><Select value={protocol}
          aria-label={t('market.discoveryProtocol')} onChange={setProtocol}
          options={MARKET_PROTOCOLS.map(value => ({ value, label: value }))} /></label>
      </div>
      <p className="pm-muted">{t('market.discoveryHint')}</p>
    </details>
    {notice && <p className={`pm-discovery-notice${notice.error ? ' pm-discovery-error' : ''}`}
      role={notice.error ? 'alert' : 'status'}>{t(notice.key, { count: notice.count ?? 0 })}</p>}
  </div>;
}
