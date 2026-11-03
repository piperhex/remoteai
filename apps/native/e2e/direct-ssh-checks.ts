import { NativeModules } from 'react-native';
import { fromByteArray } from 'base64-js';
import { createDirectSshClient, type DirectSshBridge } from '../src/ssh/directClient';
import type { SshProfile, SshProfileStore } from '../../../shared/terminal/sshProfiles';
import type { SshCredentials } from '../../../shared/terminal/sshCredentials';

const CONTROL = 'http://127.0.0.1:15995';
interface Config { host: string; port: number; username: string; password: string; privateKey: string }

function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
async function rejects(action: Promise<unknown>, key: string) {
  const error = await action.then(() => '', error => error instanceof Error ? error.message : String(error));
  assert(error === key, `Expected ${key}, received ${error}`);
}

function profileStore(config: Config) {
  let profiles: SshProfile[] = ['password', 'key'].map(auth => ({ id: auth,
    name: auth === 'key' ? 'SSH key server' : 'SSH password server',
    host: config.host, port: config.port, username: config.username, auth: auth as 'password' | 'key', revision: 1 }));
  const credentials = new Map<string, SshCredentials>([
    ['password', { password: config.password }], ['key', { privateKey: config.privateKey }],
  ]);
  const store: SshProfileStore = {
    list: async () => profiles,
    save: async (profile, secret) => {
      if (secret) credentials.set(profile.id, secret);
      profiles = [...profiles.filter(value => value.id !== profile.id), { ...profile, revision: (profile.revision ?? 0) + 1 }];
      return profiles;
    },
    remove: async id => { profiles = profiles.filter(value => value.id !== id); return profiles; },
    credentials: async profile => credentials.get(profile.id),
  };
  return store;
}

export async function verifyDirectSsh() {
  const config = await fetch(`${CONTROL}/config`).then(reply => reply.json()) as Config;
  const profiles = profileStore(config);
  const connection = createDirectSshClient({ bridge: NativeModules.DirectSsh as DirectSshBridge,
    scope: 'direct-ssh-fixture', profiles });
  const { client } = connection;
  const endpoint = { host: config.host, port: config.port };
  const fingerprint = await client.ssh.probe(endpoint);
  const request = { endpoint, username: config.username, fingerprint, size: { cols: 80, rows: 24 } };
  await rejects(client.ssh.open({ ...request, password: config.password, fingerprint: 'SHA256:wrong' }, ''),
    'client.ssh.hostChanged');
  await rejects(client.ssh.open({ ...request, password: 'incorrect-password' }, ''), 'client.ssh.authenticationFailed');
  for (const credentials of [{ password: config.password }, { privateKey: config.privateKey }]) {
    const session = await client.ssh.open({ ...request, ...credentials }, '');
    await client.resize(session.id, { cols: 100, rows: 32 });
    await client.write(session.id, "printf 'phone-direct-%s\\n' 'verified'\r");
    let text = '';
    let cursor = 0;
    for (let attempt = 0; attempt < 40 && !text.includes('phone-direct-verified'); attempt++) {
      const read = await client.read(session.id, cursor);
      cursor = read.cursor;
      for (const event of read.events) if (event.type === 'output') text += String.fromCharCode(...event.data);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(text.includes('phone-direct-verified'), 'Native shell output');
    const listing = await client.ssh.files(session.id, { type: 'list', path: '.' });
    assert(listing.type === 'list' && listing.entries.some(value => value.name === 'hello.txt'), 'SFTP list');
    const path = `/phone-${Date.now()}.txt`;
    const data = fromByteArray(new TextEncoder().encode('phone direct upload\n'));
    await client.ssh.files(session.id, { type: 'upload', path, data });
    const read = await client.ssh.files(session.id, { type: 'read', path });
    assert(read.type === 'file' && read.data === data, 'SFTP round trip');
    await client.ssh.files(session.id, { type: 'delete', path });
    await client.close(session.id);
    assert(!(await client.read(session.id, 0)).found, 'Closed session released');
  }
  await fetch(`${CONTROL}/result`, { method: 'POST', body: JSON.stringify({ passed: true,
    checks: ['fingerprint rejection', 'password rejection', 'password and private key login', 'PTY input/output',
      'resize', 'SFTP list/upload/read/delete', 'session close'] }) });
  return connection;
}

export async function reportDirectSshFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await fetch(`${CONTROL}/result`, { method: 'POST', body: JSON.stringify({ passed: false, message }) });
  return message;
}
