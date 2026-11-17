import { beforeEach, expect, it, vi } from 'vitest';
import { desktopSessionCrypto } from './sessionCipher';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: mocks.invoke }));
const create = () => desktopSessionCrypto.createSessionCipher!({ secret: new Uint8Array(32).fill(7),
  publicKey: '09'.repeat(32), sessionId: 'test', desktop: true });
beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation(async (command: string, args: { operations?: unknown[] }) => {
    if (command === 'remote_chat_crypto_open') return 'native';
    if (command === 'remote_chat_crypto_batch') return args.operations!.map(() => 'ciphertext');
    return undefined;
  });
});

it('batches packet operations and keeps all plaintext crypto calls in the backend', async () => {
  const cipher = create();
  const packets = Array.from({ length: 65 }, (_, index) => cipher.encrypt(`packet-${index}`));
  expect(await Promise.all(packets)).toEqual(Array(65).fill('ciphertext'));
  const batches = mocks.invoke.mock.calls.filter(([command]) => command === 'remote_chat_crypto_batch');
  expect(batches.map(([, request]) => request.operations.length)).toEqual([32, 32, 1]);
  expect(batches[0][1].operations[0]).toEqual({ kind: 'encrypt', text: 'packet-0', compress: false });
  cipher.destroy();
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('remote_chat_crypto_close', { id: 'native' }));
});

it('rejects native failures without using a JS encryption fallback', async () => {
  mocks.invoke.mockRejectedValue(new Error('backend unavailable'));
  const cipher = create();
  await expect(cipher.encrypt('private message')).rejects.toThrow('backend unavailable');
  cipher.destroy();
});

it('submits direct plaintext batches without returning encrypted payloads through JS', async () => {
  const cipher = create(), target = { peer: 'peer', channel: 'channel', envelopes: 2 };
  await Promise.all([cipher.sendDirect!(target, 'first'), cipher.sendDirect!(target, 'second', true)]);
  expect(mocks.invoke).toHaveBeenCalledWith('remote_chat_crypto_batch', { id: 'native', operations: [
    { kind: 'send', target, text: 'first', compress: false },
    { kind: 'send', target, text: 'second', compress: true },
  ] });
  cipher.destroy();
});

it('coalesces packets arriving across microtasks while an IPC batch is in flight', async () => {
  let complete!: (result: string[]) => void;
  mocks.invoke.mockImplementation(async (command: string, args: { operations?: unknown[] }) => {
    if (command === 'remote_chat_crypto_open') return 'native';
    if (command !== 'remote_chat_crypto_batch') return;
    if (!complete) return new Promise<string[]>(resolve => { complete = resolve; });
    return args.operations!.map(() => 'ciphertext');
  });
  const cipher = create(), packets = [cipher.encrypt('first')];
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  for (let index = 0; index < 20; index++) {
    packets.push(cipher.encrypt(`later-${index}`));
    await Promise.resolve();
  }
  complete(['ciphertext']);
  await Promise.all(packets);
  const batches = mocks.invoke.mock.calls.filter(([command]) => command === 'remote_chat_crypto_batch');
  expect(batches.map(([, request]) => request.operations.length)).toEqual([1, 20]);
  cipher.destroy();
});

it('cleans up a session opened after cancellation and rejects queued plaintext', async () => {
  let opened!: (id: string) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { opened = resolve; }));
  const cipher = create();
  const packet = expect(cipher.encrypt('queued')).rejects.toThrow('CHAT_PACKET_CODEC');
  cipher.destroy(); opened('late'); await packet;
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('remote_chat_crypto_close', { id: 'late' }));
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'remote_chat_crypto_batch')).toBe(false);
});
