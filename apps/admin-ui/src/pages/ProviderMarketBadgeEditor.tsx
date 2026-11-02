import { useState } from 'react';
import { Button, Input, Popover, Select, Space } from 'antd';
import { MarketBadgeTag } from '../../../../shared/provider-market/MarketStatus';
import { MARKET_BADGE_TONES, type MarketBadge } from '../../../../shared/provider-market/types';
import type { MarketText } from '../../../../shared/provider-market/i18n';

export function ProviderMarketBadgeEditor({ badge, busy, t, onSave }: {
  badge?: MarketBadge | null; busy: boolean; t: MarketText;
  onSave: (badge: MarketBadge | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(badge?.text ?? '');
  const [tone, setTone] = useState<MarketBadge['tone']>(badge?.tone ?? 'orange');
  const save = async (value: MarketBadge | null) => { if (await onSave(value)) setOpen(false); };
  return <Popover open={open} onOpenChange={value => { if (!busy) setOpen(value); }} trigger="click"
    title={t('market.marketingBadge')} overlayStyle={{ maxWidth: 400 }} content={
      <div className="provider-market pm-editor" style={{ width: 320, maxWidth: 'calc(100vw - 64px)' }}>
        <label><span>{t('market.badgeText')}</span><Input aria-label={t('market.badgeText')}
          maxLength={24} value={text} disabled={busy} onChange={event => setText(event.target.value)} /></label>
        <label><span>{t('market.badgeColor')}</span><Select aria-label={t('market.badgeColor')}
          value={tone} disabled={busy} onChange={setTone} options={MARKET_BADGE_TONES.map(value => ({
            value, label: t(`market.badgeColor.${value}`),
          }))} /></label>
        <MarketBadgeTag badge={{ text: text.trim(), tone }} />
        <Space wrap><Button type="primary" loading={busy} disabled={!text.trim()}
          onClick={() => void save({ text: text.trim(), tone })}>{t('market.saveBadge')}</Button>
          <Button disabled={busy || !badge} onClick={() => void save(null)}>{t('market.clearBadge')}</Button></Space>
      </div>}>
    <Button size="small" disabled={busy}>{t('market.marketingBadge')}</Button>
  </Popover>;
}
