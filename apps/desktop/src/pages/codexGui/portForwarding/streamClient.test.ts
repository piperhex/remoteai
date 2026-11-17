import { expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { MappingStreamClient, type MappingStreamBridge } from '../../../../../../shared/port-mapping/streamClient';
import { BulkCipher } from '../../../../../../shared/remote-chat/bulkCipher';
import { BulkTransport } from '../../../../../../shared/remote-chat/bulkTransport';
import { STREAM_MANIFEST, type MappingStreamLink } from '../../../../../../shared/port-mapping/streamMux';
import { openMappingSocket, type MappingSocket } from '../../../../../../shared/port-mapping/socket';
import { encodeStreamFrame } from '../../../../../../shared/port-mapping/streamProtocol';
import { MAPPING_RECONNECT_REQUIRED, MAPPING_UPDATE_REQUIRED } from '../../../../../../shared/port-mapping/errors';

function receiver(close = vi.fn<() => void>()) { return { close, bind: vi.fn(async () => {}), unbind: vi.fn() }; }

function fixture(register?: MappingStreamBridge, supported = true, failed = vi.fn<() => void>()) {
  const transport = new BulkTransport({ available: () => true, send: async () => {} });
  transport.setMode('relay');
  let link: MappingStreamLink = { bulk: transport, createBulkCipher: identity => new BulkCipher(new Uint8Array(32),
    { ...identity, sessionId: 'one', desktopKey: 'host', clientKey: 'client', desktop: false }) };
  const request = vi.fn(async (body: object) => 'request' in body ? { type: 'socket', id: 'legacy' } : {});
  const client = new MappingStreamClient({ link: () => link, random: randomBytes, supported: () => supported,
    request: async <T>(body: object) => await request(body) as T, register, failed });
  return { client, request, transport, failed, reconnect: () => { client.close(); link = { ...link }; },
    close: () => { client.close(); transport.close(); } };
}

it('binds the native receiver before sending open and releases it when the socket closes', async () => {
  const native = receiver();
  const peer = fixture(async () => native);
  peer.request.mockImplementation(async body => {
    if ('action' in body && body.action === 'open') {
      if (!('id' in body)) throw new Error('Missing stream identity');
      expect(native.bind).toHaveBeenCalledWith(body.id, 42);
    }
    return {};
  });
  try {
    const socket = await peer.client.open('resource', 'http://127.0.0.1', { nativeSocketId: 42 });
    socket.close(); expect(native.unbind).toHaveBeenCalledTimes(1);
  } finally { peer.close(); }
});

it('fails native binding without opening a remote socket or falling back to the script receiver', async () => {
  const native = receiver();
  native.bind.mockRejectedValueOnce(new Error('Socket unavailable'));
  const peer = fixture(async () => native);
  try {
    await expect(peer.client.open('resource', 'http://127.0.0.1', { nativeSocketId: 42 }))
      .rejects.toThrow('Socket unavailable');
    expect(peer.request.mock.calls.some(([body]) => 'action' in body && body.action === 'open')).toBe(false);
    expect(native.unbind).toHaveBeenCalledTimes(1);
  } finally { peer.close(); }
});

it('isolates a failed native socket while other streams keep their authenticated session', async () => {
  let bridge!: Parameters<MappingStreamBridge>[0];
  const native = receiver();
  const peer = fixture(async options => { bridge = options; return native; });
  try {
    const failed = await peer.client.open('resource', 'http://127.0.0.1', { nativeSocketId: 42 });
    const healthy = await peer.client.open('resource', 'http://127.0.0.1', { nativeSocketId: 43 });
    const failedId = (peer.request.mock.calls[0][0] as { id: string }).id;
    const healthyId = (peer.request.mock.calls[1][0] as { id: string }).id;
    bridge.progress(failedId, { consumed: 0, eof: false, failed: true });
    await expect(failed.read()).rejects.toThrow('closed');
    bridge.progress(healthyId, { consumed: 1024, eof: true });
    await expect(healthy.read()).resolves.toEqual({ data: new Uint8Array(), eof: true });
    expect(native.unbind.mock.calls).toEqual([[failedId]]);
    expect(native.close).not.toHaveBeenCalled();
  } finally { peer.close(); }
});

it.each(['native', 'cipher'])('requires reconnect after %s failure without downgrading or replacing the epoch', async failure => {
  let fail!: () => void;
  const release = vi.fn();
  const register = vi.fn(async (options: Parameters<MappingStreamBridge>[0]) => {
    fail = options.failed; return receiver(release);
  });
  const peer = fixture(register);
  try {
    const first = await peer.client.open('resource', 'http://127.0.0.1:3002');
    const reading = expect(first.read()).rejects.toThrow('closed');
    if (failure === 'native') fail();
    else {
      const cipher = new BulkCipher(new Uint8Array(32).fill(9), { ...register.mock.calls[0][0].identity,
        manifestId: STREAM_MANIFEST, sessionId: 'one', desktopKey: 'host', clientKey: 'client', desktop: true });
      peer.transport.receive(cipher.encrypt({ requestId: '33333333-3333-4333-8333-333333333333', block: 0,
        offset: 0 }, Uint8Array.of(1)), 'relay');
      cipher.destroy();
    }
    await reading;
    for (let index = 0; index < 3; index++) {
      await expect(peer.client.open('resource', 'http://127.0.0.1:3002')).rejects.toThrow(MAPPING_RECONNECT_REQUIRED);
    }
    expect(register).toHaveBeenCalledTimes(1);
    expect(peer.failed).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledTimes(1);
    expect(peer.request.mock.calls.filter(([body]) => 'request' in body)).toHaveLength(0);
    peer.client.close(); await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
  } finally { peer.close(); }
});

it('reconnects the owner once after receiver failure and ignores callbacks from the retired link', async () => {
  const register = vi.fn(async (_options: Parameters<MappingStreamBridge>[0]) => receiver());
  const peer = fixture(register);
  peer.failed.mockImplementation(peer.reconnect);
  try {
    const first = await peer.client.open('resource', 'http://127.0.0.1:3002', { nativeSocketId: 42 });
    const retired = register.mock.calls[0][0];
    retired.failed();
    await expect(first.read()).rejects.toThrow('closed');
    const second = await peer.client.open('resource', 'http://127.0.0.1:3002', { nativeSocketId: 43 });
    retired.failed();
    expect(peer.failed).toHaveBeenCalledOnce();
    expect(register.mock.calls[1][0].identity).not.toEqual(retired.identity);
    await expect(second.write(Uint8Array.of(1))).resolves.toBeUndefined();
  } finally { peer.close(); }
});

it('fails a pending open if its receiver stops without falling back to RPC', async () => {
  let fail!: () => void;
  const peer = fixture(async options => { fail = options.failed; return receiver(); });
  peer.request.mockImplementationOnce(async () => { fail(); return {}; });
  try {
    await expect(peer.client.open('resource', 'http://127.0.0.1:3002')).rejects.toThrow('closed');
    expect(peer.request.mock.calls.some(([body]) => 'request' in body)).toBe(false);
  } finally { peer.close(); }
});

it('requires reconnect when native registration fails before a stream can open', async () => {
  const peer = fixture(async () => { throw new Error('Native receiver unavailable'); });
  try {
    await expect(peer.client.open('resource', 'http://127.0.0.1:3002')).rejects.toThrow(MAPPING_RECONNECT_REQUIRED);
    expect(peer.request).not.toHaveBeenCalled();
  } finally { peer.close(); }
});

it('only disables streams on the failed link and uses a fresh epoch after reconnecting', async () => {
  let fail!: () => void;
  const register = vi.fn(async (options: Parameters<MappingStreamBridge>[0]) => {
    fail = options.failed; return receiver();
  });
  const peer = fixture(register);
  try {
    const first = await peer.client.open('resource', 'http://127.0.0.1:3002');
    fail(); first.close();
    await expect(peer.client.open('resource', 'http://127.0.0.1:3002')).rejects.toThrow(MAPPING_RECONNECT_REQUIRED);
    peer.reconnect();
    (await peer.client.open('new-resource', 'http://127.0.0.1:3002')).close();
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[0][0].identity).not.toEqual(register.mock.calls[1][0].identity);
    expect(peer.request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'guiResourceStream',
      action: 'open', resource: 'new-resource' }));
  } finally { peer.close(); }
});

it('does not retry an authorization or target error over RPC', async () => {
  const peer = fixture();
  peer.request.mockRejectedValueOnce(new Error('Resource access denied'));
  try {
    await expect(peer.client.open('resource', 'http://127.0.0.1:3002')).rejects.toThrow('Resource access denied');
    expect(peer.request.mock.calls.some(([body]) => 'request' in body)).toBe(false);
  } finally { peer.close(); }
});

it('asks unsupported peers to update without opening RPC sockets', async () => {
  const register = vi.fn();
  const peer = fixture(register, false);
  try {
    await expect(peer.client.open('resource', 'http://127.0.0.1:80')).rejects.toThrow(MAPPING_UPDATE_REQUIRED);
    expect(peer.request).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  } finally { peer.close(); }
});

it('accepts authenticated native frames only for the active socket and wipes the exported receive key', async () => {
  let bridge!: Parameters<MappingStreamBridge>[0];
  const peer = fixture(async options => { bridge = options; return receiver(); });
  try {
    const socket = await peer.client.open('resource', 'http://127.0.0.1:80');
    expect(bridge.receiverKey).toEqual(new Uint8Array(32));
    const opened = peer.request.mock.calls[0][0] as { id: string };
    bridge.authenticated('unknown', encodeStreamFrame({ type: 'data', offset: 0, data: Uint8Array.of(99) }));
    bridge.authenticated(opened.id, encodeStreamFrame({ type: 'data', offset: 0, data: Uint8Array.of(7, 8) }));
    expect(await socket.read()).toEqual({ data: Uint8Array.of(7, 8), eof: false });
    peer.client.close();
    bridge.authenticated(opened.id, Uint8Array.of(0));
    await expect(socket.read()).rejects.toThrow('closed');
  } finally { peer.close(); }
});

it('rejects a missing stream adapter without opening a legacy socket', async () => {
  const client = { openResource: vi.fn(), closeResource: vi.fn(), link: vi.fn() };
  await expect(openMappingSocket(client, 'resource', 'http://127.0.0.1')).rejects.toThrow(MAPPING_UPDATE_REQUIRED);
  expect(client.link).not.toHaveBeenCalled();
});

it('registers before opening and immediately fails pending reads if the native bridge stops', async () => {
  let fail!: () => void;
  const release = vi.fn();
  const peer = fixture(async options => { fail = options.failed; return receiver(release); });
  try {
    const socket = await peer.client.open('resource', 'http://127.0.0.1:80');
    const reading = expect(socket.read()).rejects.toThrow('closed');
    fail(); await reading;
    peer.client.close(); await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
    expect(peer.request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'guiResourceStream', action: 'close' }));
  } finally { peer.close(); }
});

it('releases a delayed registration when the session closes before stream creation', async () => {
  let registered!: (value: ReturnType<typeof receiver>) => void;
  const release = vi.fn();
  const peer = fixture(() => new Promise(resolve => { registered = resolve; }));
  const opening = expect(peer.client.open('resource', 'http://127.0.0.1:80')).rejects.toThrow('changed');
  await vi.waitFor(() => expect(registered).toBeTypeOf('function'));
  peer.client.close(); registered(receiver(release));
  await opening;
  expect(release).toHaveBeenCalledTimes(1);
  expect(peer.request).not.toHaveBeenCalled(); peer.close();
});

it('cancels before socket open completes and closes the eventual socket without retaining a request slot', async () => {
  let connected!: (socket: MappingSocket) => void;
  const abort = new AbortController();
  const close = vi.fn();
  const opening = openMappingSocket({ openResource: vi.fn(), closeResource: vi.fn(), link: vi.fn(),
    stream: () => new Promise(resolve => { connected = resolve; }) }, 'resource', 'http://127.0.0.1',
  { signal: abort.signal });
  abort.abort(); await expect(opening).rejects.toThrow('cancelled');
  connected({ read: vi.fn(), write: vi.fn(), close }); await Promise.resolve();
  expect(close).toHaveBeenCalledTimes(1);
});
