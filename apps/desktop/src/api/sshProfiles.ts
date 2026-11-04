import { invoke, loadCloudAuthState } from './backend';
import { legacySshProfiles, type SshProfileStore } from '../../../../shared/terminal/sshProfiles';
import { createServerSshProfiles, parseServerSshProfiles, type SshProfileRequest }
  from '../../../../shared/terminal/serverSshProfiles';
import type { GuiCloudIdentity } from '../../../../shared/conversation/remote/types';
import { sshProfileError } from '../../../../shared/terminal/sshProfileResponse';

async function currentIdentity(): Promise<GuiCloudIdentity> {
  const auth = await loadCloudAuthState();
  if (!auth.authenticated || !auth.baseUrl || !auth.userId) throw new Error('client.ssh.signIn');
  return { baseUrl: auth.baseUrl, userId: auth.userId };
}

export function createDesktopSshProfiles(expected?: GuiCloudIdentity): SshProfileStore {
  let migration: Promise<unknown> | undefined;
  let warning = '';
  const importLegacy = async (send: (value: SshProfileRequest) => Promise<unknown>) => {
    try {
      const legacy = legacySshProfiles();
      if (legacy.profiles.length) {
        parseServerSshProfiles(await send({ type: 'import', profiles: legacy.profiles }));
        legacy.complete();
      }
      warning = '';
    } catch (error) { warning = sshProfileError(error); }
  };
  const exchange = async (request: SshProfileRequest, scope?: string) => {
    // Bind the native request to the identity checked before this operation, even during a login change.
    const [baseUrl, userId] = JSON.parse(scope ?? '[]') as string[];
    if (!baseUrl || !userId) throw new Error('client.ssh.signIn');
    const identity = { baseUrl, userId };
    const send = (value: SshProfileRequest) => invoke<unknown>('cloud_ssh_profiles', { identity, request: value });
    if (request.type === 'list') {
      migration ??= importLegacy(send).finally(() => { migration = undefined; });
      await migration;
    }
    return send(request);
  };
  const store = createServerSshProfiles(exchange, async () => {
    const current = await currentIdentity();
    if (expected && (expected.baseUrl !== current.baseUrl || expected.userId !== current.userId)) {
      throw new Error('client.ssh.signIn');
    }
    return JSON.stringify([current.baseUrl, current.userId]);
  });
  return { ...store, warning: () => warning };
}

export const desktopSshProfiles = createDesktopSshProfiles();
