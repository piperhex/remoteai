import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { PortForwardingService, type ForwardingClient } from './service';
import { PortForwardingService as SharedService } from '../../../../../../shared/port-mapping/service';
import type { TerminalLinkReply } from '../../../../../../shared/terminal/links';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
let service: PortForwardingService;
let client: ForwardingClient;
let nextId: number;
const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };

beforeEach(() => {
  vi.clearAllMocks(); nextId = 0;
  client = { openResource: vi.fn(async () => `resource-${++nextId}`), closeResource: vi.fn(async () => undefined),
    stream: vi.fn(async () => ({ read: vi.fn(), write: vi.fn(), close: vi.fn() })),
    link: vi.fn(async (_id, request): Promise<TerminalLinkReply> => request.type === 'connect'
      ? { type: 'socket', id: `remote-${++nextId}` } : { type: 'done' }) };
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const request = (args as { request: { type: string; port?: number } }).request;
    if (request.type === 'listen') return { type: 'listener', id: `local-${request.port}`, port: request.port };
    if (request.type === 'accept') return new Promise(() => undefined);
    return { type: 'done' };
  });
  service = new PortForwardingService(client); service.setConnected(true);
});
afterEach(async () => { service.dispose(); await flush(); });

it('publishes the consumer only after a listener starts and tolerates hosts without reporting support', async () => {
  const device = { deviceId: 'office', name: 'Office PC' };
  const mappingActive = vi.fn(async () => { throw new Error('Unknown operation'); });
  service = new PortForwardingService({ ...client, mappingActive }, [], undefined, () => device);
  service.setConnected(true);
  const id = service.save({ remotePort: 3000, localPort: 13000 });
  expect(mappingActive).not.toHaveBeenCalled();
  vi.mocked(client.openResource).mockRejectedValueOnce(new Error('Disconnected'));
  await service.start(id);
  expect(mappingActive).not.toHaveBeenCalled();
  await service.start(id);
  expect(service.snapshot()[0].status).toBe('running');
  expect(mappingActive).toHaveBeenCalledWith('resource-1', id, device);
});

it('maps multiple remote ports through authenticated resources and stops them independently', async () => {
  service.add(3000, 13000); service.add(5432, 15432); await flush();
  expect(service.snapshot().map(entry => entry.status)).toEqual(['running', 'running']);
  expect(client.openResource).toHaveBeenCalledWith('http://127.0.0.1:3000');
  expect(client.openResource).toHaveBeenCalledWith('http://127.0.0.1:5432');
  expect(invoke).toHaveBeenCalledWith('codex_gui_terminal_link', { request: { type: 'listen', port: 13000 } });
  const [first, second] = service.snapshot();
  await service.stop(first.id);
  expect(service.snapshot().map(entry => entry.status)).toEqual(['stopped', 'running']);
  expect(invoke).toHaveBeenCalledWith('codex_gui_terminal_link', { request: { type: 'stop', scope: 'local-13000' } });
  expect(client.closeResource).toHaveBeenCalledTimes(1);
  await service.start(first.id);
  expect(service.snapshot()[0].status).toBe('running');
  await service.remove(second.id);
  expect(service.snapshot().map(entry => entry.id)).toEqual([first.id]);
});

it('connects to the selected IP and port, preserves it on restart, and keeps local port conflicts', async () => {
  service.add(3000, 13000, '192.168.1.20');
  service.add(3000, 13001, '[::1]');
  await flush();
  expect(client.openResource).toHaveBeenCalledWith('http://192.168.1.20:3000');
  expect(client.stream).toHaveBeenCalledWith(expect.any(String), 'http://[::1]:3000',
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(client.link).not.toHaveBeenCalled();
  expect(() => service.add(3000, 13000, '192.168.1.21')).toThrow('本地端口已有映射');
  const first = service.snapshot()[0];
  await service.stop(first.id); await service.start(first.id);
  expect(client.openResource).toHaveBeenLastCalledWith('http://192.168.1.20:3000');
});

it('rejects invalid IP input before opening a resource', () => {
  expect(() => service.add(3000, 13000, '192.168.1.20:3000')).toThrow('IPv4 或 IPv6');
  expect(service.snapshot()).toEqual([]);
  expect(client.openResource).not.toHaveBeenCalled();
});

it('applies domain edits from either device without restarting the listener', async () => {
  const target = { remotePort: 3000, localPort: 13000 };
  const id = service.save({ ...target, localDomain: ' App.Localhost ' });
  await service.start(id);
  const changes = vi.fn();
  service.subscribeChanges(changes);
  expect(service.snapshot()[0].localDomain).toBe('app.localhost');
  expect(client.openResource).toHaveBeenCalledWith('http://127.0.0.1:3000');
  await expect(service.edit(id, { ...target, localDomain: 'app.localhost:80' })).rejects
    .toThrow('client.mappingEditor.invalidLocalDomain');
  await service.edit(id, { ...target, localDomain: 'second.localhost' });
  expect(service.snapshot()[0]).toMatchObject({ status: 'running', localDomain: 'second.localhost' });
  expect(changes).toHaveBeenLastCalledWith(id, expect.objectContaining({ localDomain: 'second.localhost' }));
  expect(client.closeResource).not.toHaveBeenCalled();
  service.applySaved([{ ...target, id, localDomain: 'synced.localhost' }]);
  await flush();
  expect(service.snapshot()[0]).toMatchObject({ status: 'running', localDomain: 'synced.localhost' });
  await service.edit(id, { ...target, localDomain: '' });
  expect(service.snapshot()[0]).toMatchObject({ status: 'running', localDomain: '' });
  expect(changes).toHaveBeenLastCalledWith(id, expect.objectContaining({ localDomain: '' }));
  expect(client.closeResource).not.toHaveBeenCalled();
});

it('edits a running mapping in place, releases the old port, and restarts with the new target', async () => {
  service.add(3000, 13000); await flush();
  const id = service.snapshot()[0].id;
  await service.edit(id, { remoteHost: '192.168.1.20', remotePort: 8080, localPort: 18080 });
  expect(service.snapshot()).toHaveLength(1);
  expect(service.snapshot()[0]).toMatchObject({ id, remotePort: 8080, localPort: 18080,
    remoteHost: '192.168.1.20', status: 'running', updatedAt: expect.any(Number) });
  expect(client.closeResource).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('codex_gui_terminal_link', { request: { type: 'stop', scope: 'local-13000' } });
  expect(client.openResource).toHaveBeenLastCalledWith('http://192.168.1.20:8080');
});

it('validates edits before disrupting the running listener and keeps offline edits stopped', async () => {
  service.add(3000, 13000); service.add(4000, 14000); await flush();
  const id = service.snapshot()[0].id;
  await expect(service.edit(id, { remotePort: 8080, localPort: 14000 })).rejects.toThrow('已有映射');
  expect(service.snapshot()[0]).toMatchObject({ status: 'running', remotePort: 3000 });
  expect(client.closeResource).not.toHaveBeenCalled();
  service.setConnected(false); await flush();
  await service.edit(id, { remotePort: 8080, localPort: 18080 });
  expect(service.snapshot()[0]).toMatchObject({ status: 'stopped', remotePort: 8080 });
});

it('applies remote edits to active listeners but leaves newly synced mappings stopped', async () => {
  service.add(3000, 13000); await flush();
  const original = service.snapshot()[0];
  service.applySaved([{ ...original, remotePort: 3001, localPort: 13001, updatedAt: Date.now() + 1 },
    { id: 'new', remotePort: 5000, localPort: 15000 }]);
  await flush();
  expect(service.snapshot().map(entry => entry.status)).toEqual(['running', 'stopped']);
  service.applySaved([]); await flush();
  expect(service.snapshot()).toEqual([]);
  expect(client.closeResource).toHaveBeenCalledTimes(2);
});

it('keeps only the latest edit when native listener cleanup is delayed', async () => {
  let finish!: () => void;
  const close = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const manager = new SharedService(client, [], { createId: () => 'stable-id',
    createTunnel: () => ({ resolve: async (_id, url) => url, close }) });
  manager.setConnected(true); manager.add(3000, 13000); await flush();
  const first = manager.edit('stable-id', { remotePort: 3001, localPort: 13001 });
  const second = manager.edit('stable-id', { remotePort: 3002, localPort: 13002 });
  expect(close).toHaveBeenCalledTimes(1);
  finish(); await Promise.all([first, second]);
  expect(manager.snapshot()[0]).toMatchObject({ remotePort: 3002, status: 'running' });
  expect(client.openResource).not.toHaveBeenCalledWith('http://127.0.0.1:3001');
  close.mockImplementation(async () => {}); manager.dispose(); await flush();
});

it('keeps preview mappings to different IPs on the same port independent', async () => {
  const preview = new SharedService(client, [], { mode: 'preview', createId: () => String(++nextId),
    createTunnel: () => ({ resolve: async (_id, url) => url, close: async () => {} }) });
  preview.setConnected(true);
  try {
    preview.add(3000, 3000, '192.168.1.20'); preview.add(3000, 3000, '192.168.1.21');
    expect(() => preview.add(3000, 3000, '192.168.1.20')).toThrow('目标地址已有映射');
    await flush();
    expect(preview.snapshot().map(entry => entry.status)).toEqual(['running', 'running']);
    await preview.stop(preview.snapshot()[0].id);
    expect(preview.snapshot().map(entry => entry.status)).toEqual(['stopped', 'running']);
  } finally { preview.dispose(); await flush(); }
});

it('reports occupied local ports and releases the remote resource before retry', async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if ((args as { request: { type: string } }).request.type === 'listen') {
      throw '本地端口已被占用，请换一个端口。';
    }
    return original(command, args);
  });
  service.add(3000, 3000); await flush();
  expect(service.snapshot()[0]).toMatchObject({ status: 'error', error: '本地端口已被占用，请换一个端口。' });
  expect(client.closeResource).toHaveBeenCalledTimes(1);
  vi.mocked(invoke).mockImplementation(original);
  await service.start(service.snapshot()[0].id);
  expect(service.snapshot()[0].status).toBe('running');
});

it('rejects invalid, duplicate and excessive mappings without starting extra resources', async () => {
  for (const port of [0, -1, 65536, 3.5, NaN]) expect(() => service.add(port, 3000)).toThrow('端口号');
  service.add(3000, 13000);
  expect(() => service.add(4000, 13000)).toThrow('已有映射');
  for (let index = 1; index < 8; index++) service.add(3000 + index, 13000 + index);
  expect(() => service.add(4000, 14000)).toThrow('最多添加');
  await flush(); expect(client.openResource).toHaveBeenCalledTimes(8);
});

it('releases an open arriving after deletion without affecting its replacement', async () => {
  let finish!: (id: string) => void;
  vi.mocked(client.openResource).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  service.add(3000, 13000);
  await service.remove(service.snapshot()[0].id);
  service.add(4000, 13000); await flush();
  finish('late-resource'); await flush();
  expect(client.closeResource).toHaveBeenCalledWith('late-resource');
  expect(service.snapshot()).toHaveLength(1);
  expect(service.snapshot()[0]).toMatchObject({ remotePort: 4000, status: 'running' });
});

it('stops all mappings on disconnect and keeps saved ports ready for manual restart', async () => {
  service.add(3000, 13000); service.add(5432, 15432); await flush();
  service.setConnected(false); await flush();
  expect(service.snapshot().map(entry => entry.status)).toEqual(['stopped', 'stopped']);
  expect(client.closeResource).toHaveBeenCalledTimes(2);
  await service.start(service.snapshot()[0].id);
  expect(client.openResource).toHaveBeenCalledTimes(2);
  service.setConnected(true); await service.start(service.snapshot()[0].id);
  expect(service.snapshot()[0].status).toBe('running');
});

it('cleans up a listener created while its mapping is being stopped', async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let finish!: (reply: TerminalLinkReply) => void;
  vi.mocked(invoke).mockImplementation((command, args) =>
    (args as { request: { type: string } }).request.type === 'listen'
      ? new Promise(resolve => { finish = resolve; }) : original(command, args));
  service.add(3000, 13000); await flush();
  const stopped = service.stop(service.snapshot()[0].id);
  finish({ type: 'listener', id: 'late-listener', port: 13000 });
  await stopped; await flush();
  expect(service.snapshot()[0].status).toBe('stopped');
  expect(invoke).toHaveBeenCalledWith('codex_gui_terminal_link', { request: { type: 'stop', scope: 'late-listener' } });
  expect(client.closeResource).toHaveBeenCalledTimes(1);
});

it('marks an unexpectedly closed listener as failed and releases its remote resource', async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let fail!: (error: Error) => void;
  vi.mocked(invoke).mockImplementation((command, args) =>
    (args as { request: { type: string } }).request.type === 'accept'
      ? new Promise((_resolve, reject) => { fail = reject; }) : original(command, args));
  service.add(3000, 13000); await flush();
  fail(new Error('Listener gone')); await flush();
  expect(service.snapshot()[0]).toMatchObject({ status: 'error', error: '映射已中断，请重新启动。' });
  expect(client.closeResource).toHaveBeenCalledTimes(1);
});
