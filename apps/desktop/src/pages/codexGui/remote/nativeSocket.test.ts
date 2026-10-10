import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, Channel } from '@tauri-apps/api/core';
import { NativeGuiSocket } from './nativeSocket';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class { onmessage = (_message: unknown) => {}; } }));
const identity = { baseUrl: 'https://cloud.example/api', userId: 'owner' };
const sockets: NativeGuiSocket[] = [];
const flush = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); };
async function connect(assistanceId?: string) {
  const socket = new NativeGuiSocket(identity, assistanceId);
  sockets.push(socket);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', deviceId: 'other', publicKey: 'ab'.repeat(32),
    role: 'mobile', accessToken: 'must-not-cross-ipc', resume: { sessionId: 'session', resumeToken: 'resume' } }));
  await flush();
  return socket;
}

beforeEach(() => { vi.mocked(invoke).mockReset().mockResolvedValue(undefined); });
afterEach(async () => { sockets.splice(0).forEach(socket => socket.close()); await flush(); });

it('binds an assistance connection to its invitation without forwarding cloud credentials', async () => {
  await connect('invitation-id');
  expect(invoke).toHaveBeenCalledWith('gui_remote_open', expect.objectContaining({
    request: expect.objectContaining({ assistanceId: 'invitation-id', deviceId: 'other', identity }),
  }));
  expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain('must-not-cross-ipc');
});

it('passes public peer identity to native authentication without forwarding credentials', async () => {
  const socket = await connect();
  expect(invoke).toHaveBeenCalledWith('gui_remote_open', { request: { clientId: socket.clientId,
    deviceId: 'other', identity, publicKey: 'ab'.repeat(32), resume: { sessionId: 'session', resumeToken: 'resume' },
    bulkEvents: expect.any(Channel) },
    events: expect.any(Channel) });
  expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain('must-not-cross-ipc');
  socket.send(JSON.stringify({ type: 'signal', sessionId: 'session', payload: { kind: 'key', key: 'peer' } }));
  await flush();
  expect(invoke).toHaveBeenCalledWith('gui_remote_send', { request: { clientId: socket.clientId,
    message: { type: 'signal', sessionId: 'session', payload: { kind: 'key', key: 'peer' } } } });
  expect(socket.bufferedAmount).toBe(0);
});

it('closes only the old connection when the computer changes before native open resolves', async () => {
  let finish!: () => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const old = await connect();
  old.close();
  const next = await connect();
  finish(); await flush();
  expect(invoke).toHaveBeenCalledWith('gui_remote_close', { request: { clientId: old.clientId } });
  expect(invoke).not.toHaveBeenCalledWith('gui_remote_close', { request: { clientId: next.clientId } });
  expect(next.readyState).toBe(1);
});

it('acknowledges batches and ignores late frames after a native disconnect', async () => {
  const socket = await connect();
  const { events } = vi.mocked(invoke).mock.calls[0][1] as { events: Channel<unknown> };
  socket.onmessage = vi.fn(); socket.onclose = vi.fn();
  events.onmessage({ sequence: 7, events: [{ type: 'message', data: '{"type":"notice"}' }] });
  expect(socket.onmessage).toHaveBeenCalledWith({ data: '{"type":"notice"}' });
  expect(invoke).toHaveBeenCalledWith('gui_remote_ack', { request: { clientId: socket.clientId, sequence: 7 } });
  events.onmessage({ sequence: 0, events: [{ type: 'closed', code: 4001 }] });
  events.onmessage({ sequence: 8, events: [{ type: 'message', data: 'stale' }] });
  expect(socket.onclose).toHaveBeenCalledWith({ code: 4001 });
  expect(socket.onmessage).toHaveBeenCalledTimes(1);
  expect(socket.readyState).toBe(3);
});

it('keeps multiple computer sockets open and routes each socket independently', async () => {
  const office = await connect();
  const home = await connect();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(['gui_remote_open', 'gui_remote_open']);
  office.send(JSON.stringify({ type: 'signal', sessionId: 'office-session', payload: { kind: 'key', key: 'office' } }));
  home.send(JSON.stringify({ type: 'signal', sessionId: 'home-session', payload: { kind: 'key', key: 'home' } }));
  await flush();
  expect(invoke).toHaveBeenCalledWith('gui_remote_send', { request: { clientId: office.clientId,
    message: { type: 'signal', sessionId: 'office-session', payload: { kind: 'key', key: 'office' } } } });
  expect(invoke).toHaveBeenCalledWith('gui_remote_send', { request: { clientId: home.clientId,
    message: { type: 'signal', sessionId: 'home-session', payload: { kind: 'key', key: 'home' } } } });
  office.close(); await flush();
  expect(home.readyState).toBe(1);
  expect(invoke).not.toHaveBeenCalledWith('gui_remote_close', { request: { clientId: home.clientId } });
});

it('drains peer-close before replacing a socket so abandoned sessions do not fill the remote computer', async () => {
  const old = await connect();
  old.send(JSON.stringify({ type: 'peer-close', sessionId: 'old-session' }));
  old.close();
  const next = await connect();
  await flush();
  const calls = vi.mocked(invoke).mock.calls;
  const commands = calls.map(([command]) => command);
  expect(commands).toEqual(['gui_remote_open', 'gui_remote_send', 'gui_remote_close', 'gui_remote_open']);
  expect(calls[1][1]).toEqual({ request: { clientId: old.clientId,
    message: { type: 'peer-close', sessionId: 'old-session' } } });
  expect(next.readyState).toBe(1);
});

it('keeps a PC client connected after diagnostic IPC rejection and sends the next chat frame', async () => {
  const socket = await connect();
  socket.onclose = vi.fn();
  vi.mocked(invoke).mockRejectedValueOnce(new Error('unsupported diagnostic frame'));
  socket.send(JSON.stringify({ type: 'diagnostic', sessionId: 'session', payload: { event: 'peer-created' } }));
  const relay = { type: 'relay', sessionId: 'session', payload: 'aabb' };
  socket.send(JSON.stringify(relay)); await flush();
  expect(socket.onclose).not.toHaveBeenCalled();
  expect(socket.readyState).toBe(1);
  expect(socket.bufferedAmount).toBe(0);
  expect(invoke).toHaveBeenLastCalledWith('gui_remote_send', {
    request: { clientId: socket.clientId, message: relay },
  });
});

it('still closes a PC client when a chat frame fails to cross IPC', async () => {
  const socket = await connect();
  socket.onclose = vi.fn();
  vi.mocked(invoke).mockRejectedValueOnce(new Error('transport unavailable'));
  socket.send(JSON.stringify({ type: 'relay', sessionId: 'session', payload: 'aabb' })); await flush();
  expect(socket.onclose).toHaveBeenCalledWith({ code: 1006 });
  expect(socket.readyState).toBe(3);
  expect(socket.bufferedAmount).toBe(0);
});
