import { useEffect, useRef } from 'react';
import { Alert, Button, Empty, Spin } from 'antd';
import type { MarketText } from './i18n';
import type { useMarket } from './useMarket';
import { MarketCard } from './MarketCard';

const PRELOAD_DISTANCE = 240;

export function MarketFeed({ market, t }: { market: ReturnType<typeof useMarket>; t: MarketText }) {
  const endRef = useRef<HTMLDivElement>(null);
  const canLoad = market.hasMore && !market.loading && !market.loadingMore && !market.loadMoreError && !market.busy;
  useEffect(() => {
    const end = endRef.current;
    if (!end || !canLoad) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) market.loadMore();
    }, { root: end.closest('.pm-catalog-scroll'),
      rootMargin: `0px 0px ${PRELOAD_DISTANCE}px 0px` });
    observer.observe(end);
    return () => observer.disconnect();
  }, [canLoad, market.loadMore, market.result.items.length]);

  if (market.loading) return <div role="status" className="pm-loading"><Spin /> {t('market.loading')}</div>;
  return <>
    {!market.result.items.length ? <Empty description={t('market.empty')} /> :
      <div className="pm-list">{market.result.items.map((item) => <MarketCard key={item.id} item={item}
        owned={!item.official && !!market.identity && item.ownerId === market.identity.userId}
        busy={market.busy} t={t} onSelect={market.setSelected} onEdit={market.setEditor} onWrite={market.write} />)}</div>}
    {(market.hasMore || market.loadingMore || market.loadMoreError) && <div className="pm-feed-tail" ref={endRef}>
      {market.loadingMore && <div role="status"><Spin size="small" /> {t('market.loading')}</div>}
      {market.loadMoreError && <Alert type="error" showIcon message={t(market.loadMoreError)}
        action={<Button disabled={market.busy} onClick={market.loadMore}>{t('market.retry')}</Button>} />}
    </div>}
  </>;
}
