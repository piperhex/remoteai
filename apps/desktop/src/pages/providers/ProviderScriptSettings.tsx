import { BalanceQueryEditor } from '../../../../../shared/provider-market/BalanceQueryEditor';
import { marketText } from '../../../../../shared/provider-market/i18n';
import type { MarketBalanceQuery } from '../../../../../shared/provider-market/types';
import { guiLanguage } from '../../../../../shared/localization/uiText';
import '../../../../../shared/provider-market/market.css';

export function ProviderScriptSettings({ value, onChange }: {
  value: MarketBalanceQuery | null; onChange: (value: MarketBalanceQuery | null) => void;
}) {
  return <div className="provider-market"><BalanceQueryEditor value={value}
    onChange={onChange} t={marketText(guiLanguage())} /></div>;
}
