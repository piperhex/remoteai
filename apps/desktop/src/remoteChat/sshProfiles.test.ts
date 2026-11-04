// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createServerSshProfiles, sshProfileHttpExchange,
  type SshProfileRequest, type SshProfileJson } from '../../../../shared/terminal/serverSshProfiles';
import { createDesktopSshProfiles } from '../api/sshProfiles';
import { invoke, loadCloudAuthState } from '../api/backend';
import { readSshProfiles, saveSshProfiles } from '../../../../shared/terminal/sshProfiles';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { RemoteTerminals } from './terminals';

vi.mock('../api/backend', () => ({ invoke: vi.fn(), loadCloudAuthState: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../pages/codexGui/terminal/sshApi', () => ({ openNativeSsh: vi.fn(), sshFiles: vi.fn(), probeSsh: vi.fn() }));
vi.mock('../pages/codexGui/terminal/api', () => ({ terminalApi: {} }));
afterEach(() => { localStorage.clear(); vi.resetAllMocks(); });
const profile = { id: 'desktop', name: 'Server', host: 'server.test', port: 22, username: 'me',
  auth: 'password' as const, fingerprint: 'SHA256:known' };
const identity = { baseUrl: 'https://test.invalid', userId: 'owner' };

function login(userId = 'owner') {
  vi.mocked(loadCloudAuthState).mockResolvedValue({ ...identity, userId, authenticated: true,
    enabled: true, userEmail: 'test@example.test', lastSyncAt: null, sessionExpired: false });
}

it('uses server HTTP paths and removes all credentials before serializing writes', async () => {
  const json = vi.fn<SshProfileJson>().mockResolvedValue([{ ...profile, revision: 1 }]);
  const store = createServerSshProfiles(sshProfileHttpExchange(json));
  await store.list();
  expect(json.mock.calls[0]).toEqual(['/sync/ssh-profiles', expect.objectContaining({ method: 'GET' })]);
  await store.save({ ...profile, password: 'secret', privateKey: 'PRIVATE', passphrase: 'secret' } as typeof profile);
  expect(json).toHaveBeenLastCalledWith('/sync/ssh-profiles/desktop', expect.objectContaining({
    method: 'PUT',
  }));
  expect(JSON.parse(String(json.mock.calls.at(-1)?.[1].body))).toEqual(profile);
  await store.remove('desktop', 1);
  expect(json).toHaveBeenLastCalledWith('/sync/ssh-profiles/desktop', expect.objectContaining({
    method: 'DELETE', body: '{"revision":1}',
  }));
});

it('reads profiles without contacting a PC, including when the remote transport is offline', async () => {
  const exchange = vi.fn(async () => [{ ...profile, revision: 1 }]);
  const request = vi.fn(async () => { throw new Error('PC offline'); });
  const controller = new ChatController(() => ({ request, start() {}, stop() {} }), undefined, undefined,
    createServerSshProfiles(exchange));
  expect(await controller.guiTools.terminal.ssh.profiles.list()).toEqual([{ ...profile, revision: 1 }]);
  expect(request).not.toHaveBeenCalled();
});

it('imports legacy PC metadata once, keeps the server revision and clears only the acknowledged snapshot', async () => {
  login(); saveSshProfiles([profile]);
  vi.mocked(invoke).mockResolvedValue([{ ...profile, name: 'Server wins', revision: 3 }]);
  const store = createDesktopSshProfiles(identity);
  const values = await store.list(); await store.list();
  expect(values[0]).toMatchObject({ name: 'Server wins', revision: 3 });
  expect(readSshProfiles()).toEqual([]);
  expect(vi.mocked(invoke).mock.calls.filter(([, args]) =>
    (args as { request: SshProfileRequest }).request.type === 'import')).toHaveLength(1);
  expect(invoke).toHaveBeenCalledWith('cloud_ssh_profiles', { identity,
    request: { type: 'import', profiles: [profile] } });
});

it('retains legacy data after failed import and retries without reporting a local save as cloud success', async () => {
  login(); saveSshProfiles([profile]);
  vi.mocked(invoke).mockRejectedValue('client.ssh.syncFailed');
  const store = createDesktopSshProfiles(identity);
  await expect(store.list()).rejects.toBe('client.ssh.syncFailed');
  expect(readSshProfiles()).toEqual([profile]);
  vi.mocked(invoke).mockResolvedValue([{ ...profile, revision: 1 }]);
  expect(await store.list()).toHaveLength(1);
  expect(readSshProfiles()).toEqual([]);
});

it('keeps legacy data edited during import and refuses writes from the previous login', async () => {
  login(); saveSshProfiles([profile]);
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    if ((args as { request: SshProfileRequest }).request.type === 'import') {
      saveSshProfiles([{ ...profile, name: 'Concurrent old window edit' }]);
    }
    return [{ ...profile, revision: 1 }];
  });
  const store = createDesktopSshProfiles();
  const [saved] = await store.list();
  expect(readSshProfiles()[0].name).toBe('Concurrent old window edit');
  const calls = vi.mocked(invoke).mock.calls.length;
  login('other');
  await expect(store.save(saved)).rejects.toThrow('client.ssh.signIn');
  await expect(store.remove(saved.id, saved.revision, saved.accountScope)).rejects.toThrow('client.ssh.signIn');
  expect(invoke).toHaveBeenCalledTimes(calls);
});

it('rejects malformed server responses, unsafe IDs and unknown deletion revisions', async () => {
  const exchange = vi.fn(async () => [profile]);
  const store = createServerSshProfiles(exchange);
  await expect(store.list()).rejects.toThrow('client.ssh.loadFailed');
  await expect(store.save({ ...profile, id: '../other' })).rejects.toThrow('client.ssh.invalid');
  await expect(store.remove('desktop')).rejects.toThrow('client.ssh.profileChanged');
});

it('stops legacy clients from creating a second PC-only copy after migration', async () => {
  const host = new RemoteTerminals();
  await expect(host.request({ operation: 'guiTerminalSshProfileSave', profile }, 'owner'))
    .rejects.toThrow('client.ssh.updateRequired');
  expect(readSshProfiles()).toEqual([]);
});

it('keeps cloud records manageable when a full account prevents importing legacy records', async () => {
  login(); saveSshProfiles([profile]);
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    if ((args as { request: SshProfileRequest }).request.type === 'import') throw 'client.ssh.profileLimit';
    return [{ ...profile, id: 'cloud-only', revision: 1 }];
  });
  const store = createDesktopSshProfiles(identity);
  const [saved] = await store.list();
  expect(saved.id).toBe('cloud-only');
  expect(store.warning?.()).toBe('client.ssh.profileLimit');
  expect(readSshProfiles()).toEqual([profile]);
  await store.remove(saved.id, saved.revision, saved.accountScope);
  expect(invoke).toHaveBeenLastCalledWith('cloud_ssh_profiles', { identity,
    request: { type: 'remove', id: 'cloud-only', revision: 1 } });
});
