import type { Page } from '@playwright/test';
import type { SshProfile } from '../../../shared/terminal/sshProfiles';
import type { SshCredentials } from '../../../shared/terminal/sshCredentials';

/** Account storage fixture keeps credentials separate, as the synchronization API does. */
export async function mockDiscoverySshStore(page: Page, initial: SshProfile[] = []) {
  const store = { profiles: initial, failSave: false,
    writes: [] as Array<SshProfile & { credentials?: SshCredentials }>,
    secrets: new Map<string, SshCredentials>() };
  await page.route('**/sync/ssh-profiles**', async route => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/')[3];
    if (request.url().endsWith('/credentials')) {
      await route.fulfill({ json: { credentials: store.secrets.get(id) ?? null } }); return;
    }
    if (request.method() === 'PUT') {
      if (store.failSave) {
        await route.fulfill({ status: 503, json: { message: 'client.ssh.storageFailed' } }); return;
      }
      const value = request.postDataJSON() as SshProfile & { credentials?: SshCredentials };
      store.writes.push(value);
      const { credentials, ...profile } = value;
      if (credentials) store.secrets.set(id, credentials);
      store.profiles = [...store.profiles.filter(item => item.id !== id),
        { ...profile, revision: (profile.revision ?? 0) + 1 }];
    }
    await route.fulfill({ json: store.profiles });
  });
  return store;
}
