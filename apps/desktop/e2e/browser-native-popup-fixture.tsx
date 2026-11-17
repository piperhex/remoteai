import { useEffect } from 'react';
import { useBrowserData } from '../../../shared/browser/data/context';

/** Only the isolated native popup harness enables this deterministic test vault. */
export function NativePopupFixture() {
  const { vault, hydrated } = useBrowserData();
  useEffect(() => {
    if (!hydrated) return;
    void vault.unlock('native-popup-fixture').then(() => {
      if (!vault.snapshot().entries.length) vault.save({ origin: 'http://127.0.0.1:18316',
        username: 'popup-fixture@example.test', password: 'fixture-only-secret' });
      document.body.dataset.popupFixture = 'ready';
    }).catch(error => { document.body.dataset.popupFixture = 'failed'; console.error(error); });
  }, [vault, hydrated]);
  return null;
}
