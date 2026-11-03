import { describe, expect, it, vi } from 'vitest';
import { createDirectSshClient } from './directClient';
import type { SshProfileStore } from '../../../../shared/terminal/sshProfiles';

const profiles: SshProfileStore = { list: async () => [], save: async () => [], remove: async () => [] };
const request = { endpoint: { host: 'server.test', port: 22 }, username: 'dev', password: 'secret',
  fingerprint: 'SHA256:test', size: { cols: 80, rows: 24 } };

describe('phone-owned SSH transport', () => {
  it('connects without a device or chat transport and preserves server errors', async () => {
    const call = vi.fn(async (input: string) => {
      const { scope, request: body } = JSON.parse(input);
      expect(scope).toBe('phone');
      expect(body).not.toHaveProperty('deviceId');
      if (body.type === 'probe') return JSON.stringify({ data: 'SHA256:test' });
      if (body.type === 'open') return JSON.stringify({ error: 'client.ssh.hostChanged' });
      return JSON.stringify({ data: [] });
    });
    const { client } = createDirectSshClient({ bridge: { call }, scope: 'phone', profiles });
    expect(await client.ssh.probe(request.endpoint)).toBe('SHA256:test');
    await expect(client.ssh.open(request, '')).rejects.toThrow('client.ssh.hostChanged');
    expect(client.ssh.profiles).toBe(profiles);
    await expect(client.open('', request.size)).rejects.toThrow('client.ssh.directConnectionRequired');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('waits for an in-flight handshake before releasing the scope and rejects later requests', async () => {
    let complete!: (reply: string) => void;
    const seen: string[] = [];
    const call = vi.fn((input: string) => {
      const type = JSON.parse(input).request.type;
      seen.push(type);
      return type === 'open' ? new Promise<string>(resolve => { complete = resolve; })
        : Promise.resolve(JSON.stringify({ data: null }));
    });
    const connection = createDirectSshClient({ bridge: { call }, scope: 'phone', profiles });
    const opening = connection.client.ssh.open(request, '');
    const disposed = connection.dispose();
    expect(seen).toEqual(['open']);
    await expect(connection.client.list('')).rejects.toThrow('client.ssh.closed');
    complete(JSON.stringify({ data: { id: 'ssh-one', shell: 'SSH', cwd: '' } }));
    await opening; await disposed;
    expect(seen).toEqual(['open', 'dispose']);
    await connection.dispose();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('does not reuse desktop X11 settings or fall back to a computer when the native module is missing', async () => {
    const call = vi.fn(async (_input: string) => JSON.stringify({ data: {} }));
    const { client } = createDirectSshClient({ bridge: { call }, scope: 'phone', profiles });
    await client.ssh.open({ ...request, x11: { display: ':0' } }, '');
    expect(JSON.parse(call.mock.calls[0][0]).request.request).not.toHaveProperty('x11');
    const missing = createDirectSshClient({ scope: 'old-app', profiles });
    await expect(missing.client.ssh.probe(request.endpoint)).rejects.toThrow('client.ssh.nativeUpdateRequired');
  });
});
