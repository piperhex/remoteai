import { useCallback, useEffect, useState } from 'react';
import type { GuiSettingsAccounts, GuiSettingsClient } from '../../../../../../shared/remote-chat/guiSettings';
import { GuiAutoSwitchSettingsDialog } from '../GuiAutoSwitchSettingsDialog';

export function RemoteGuiSettingsDialog({ client, privacyMode, onClose }: {
  client: GuiSettingsClient; privacyMode: boolean; onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<GuiSettingsAccounts | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let disposed = false;
    setCatalog(null); setError(false);
    void client.accounts().then(value => { if (!disposed) setCatalog(value); })
      .catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [client, attempt]);
  return <GuiAutoSwitchSettingsDialog accounts={catalog?.accounts ?? []} providers={catalog?.providers ?? []}
    client={client} accountCatalog={{ loading: !catalog && !error, failed: error, retry }}
    privacyMode={privacyMode} onClose={onClose} />;
}
