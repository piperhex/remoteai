import { useState } from 'react';
import { Button } from 'antd';
import { Store } from 'lucide-react';
import type { Language } from '@remoteai/i18n';
import { marketText } from './i18n';
import type { MarketClient, MarketItem } from './types';
import { MarketView } from './MarketView';

export function MarketLauncher({ client, language, initialId, onOpenPage }: {
  client: MarketClient; language: Language; initialId?: string;
  onOpenPage?: (item: MarketItem) => void;
}) {
  const [open, setOpen] = useState(!!initialId);
  const t = marketText(language);
  return <>
    <Button className="provider-market-button" icon={<Store size={15} />} onClick={() => setOpen(true)}>
      <span>{t('market.title')}</span></Button>
    {open && <MarketView client={client} language={language} initialId={initialId}
      onOpenPage={onOpenPage} onClose={() => setOpen(false)} />}
  </>;
}
