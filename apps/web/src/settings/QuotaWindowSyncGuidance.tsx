import { useState } from 'react';
import { TimerReset } from 'lucide-react';
import { quotaWindowSyncText } from '@remoteai/i18n/copy/quotaWindowSync';
import { getLanguage } from '../i18n';
import { useDesktopLayout } from '../useDesktopLayout';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { SettingsRow } from './SettingsRow';

export function QuotaWindowSyncGuidance() {
  const desktopLayout = useDesktopLayout();
  const [open, setOpen] = useState(false);
  const title = quotaWindowSyncText(getLanguage(), 'settings.quotaWindowSync.title');
  if (!desktopLayout) return null;
  return <>
    <SettingsRow label={title} icon={TimerReset} onClick={() => setOpen(true)} />
    <AdaptiveSheet open={open} title={title} onClose={() => setOpen(false)} width={400}>
      <div className="settings-sync">
        <p>{quotaWindowSyncText(getLanguage(), 'settings.quotaWindowSync.cloudHint')}</p>
      </div>
    </AdaptiveSheet>
  </>;
}
