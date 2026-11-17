import { invoke } from '@tauri-apps/api/core';
import { ChatLink } from '../../../shared/remote-chat/link';
import { ChatRpc } from '../../../shared/remote-chat/rpc';
import { MultipathChannel } from '../../../shared/remote-chat/multipathChannel';
import type { PeerFactory } from '../../../shared/remote-chat/protocol';
import type { Signal, RpcMessage } from '../../../shared/remote-chat/protocol';
import { uploadPreparedSync } from '../../../shared/conversation/sync/transfer';
import { SYNC_OPERATION, type SyncBundle, type SyncHost } from '../../../shared/conversation/sync/types';
import { createDesktopPeer } from '../src/remoteChat/peer';
import { createDesktopKeyPair, createDesktopSessionCipher } from '../src/remoteChat/sessionCipher';
import { createDesktopPacketCompression } from '../src/remoteChat/packetCompression';
import { RemoteConversationSync } from '../src/remoteChat/conversationSync';
import { transferNativeSync } from '../src/remoteChat/syncTransfer';
import { eventLoopProbe } from './chat-benchmark-metrics';

type Mode = 'js-rpc' | 'rust-rpc' | 'rust-binary';
interface Fixture { id: string; source: SyncBundle; destination: SyncBundle }
const wait = async (ready: () => boolean) => {
  const deadline = Date.now() + 30000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Native chat sync fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

/** Real ChatLink/RPC, Rust RTC and bundle services; account authorization is replaced with temporary test capabilities. */
async function connection(mode: Mode, batchObserved: (packets: number) => void, envelopes = 0) {
  const left = await createDesktopKeyPair(), right = await createDesktopKeyPair(), sessionId = crypto.randomUUID();
  const service = new RemoteConversationSync();
  const errors: string[] = [];
  const payloadRequests = { read: 0, write: 0 };
  const links = {} as { server: ChatLink; client: ChatLink };
  const signal = (side: 'server' | 'client', message: object) => {
    const frame = message as { type: string; payload: Signal & string };
    const other = side === 'server' ? 'client' : 'server';
    queueMicrotask(() => {
      if (frame.type === 'relay') links[other]?.receive(frame.payload);
      if (frame.type === 'signal') void links[other]?.acceptSignal(frame.payload).catch(error => errors.push(String(error)));
    });
  };
  const rpc = new ChatRpc({ prefix: 'sync-benchmark', send: message => links.client.send(message), event: () => {} });
  const reply = async (message: RpcMessage) => {
    if (message.kind !== 'request') return;
    try {
      const data = await service.request(message.body as Record<string, unknown>, {
        owner: sessionId, mode: links.server.connectionMode,
      });
      await links.server.send({ kind: 'response', id: message.id, data });
    } catch (error) { await links.server.send({ kind: 'response', id: message.id, error: String(error) }); }
  };
  const createPeer: PeerFactory = options => createDesktopPeer({ ...options, channel: initial => {
    let channel = initial;
    for (let depth = 0; depth < envelopes; depth++) {
      const wrapper = new MultipathChannel({ disconnected: options.disconnected });
      wrapper.add(channel, 0); channel = wrapper;
    }
    options.channel(channel);
  } });
  const shared = { sessionId, transportVersion: 2, iceServers: [], createPeer,
    createPacketCompression: createDesktopPacketCompression, relayBuffered: () => 0,
    mode: () => {}, error: (error: string) => errors.push(error),
    ...(mode === 'js-rpc' ? {} : { createSessionCipher: (options: Parameters<typeof createDesktopSessionCipher>[0]) =>
      createDesktopSessionCipher(options, batchObserved) }) };
  links.server = new ChatLink({ ...shared, desktop: true, secret: left.secret, publicKey: right.publicKey,
    signal: value => signal('server', value), message: message => { void reply(message).catch(error => errors.push(String(error))); } });
  links.client = new ChatLink({ ...shared, desktop: false, secret: right.secret, publicKey: left.publicKey,
    signal: value => signal('client', value), message: message => rpc.receive(message) });
  service.attach(sessionId, links.server);
  left.secret.fill(0); right.secret.fill(0);
  await links.client.offer();
  await wait(() => links.client.connectionMode === 'direct' && links.server.connectionMode === 'direct');
  const source: SyncHost = { id: 'source', name: '', mode: () => links.client.connectionMode,
    nativeLink: () => {
      const target = links.client.nativeSyncHandle, cipher = links.client.nativeCipher;
      return target && cipher ? { target, cipher: cipher.handle } : undefined;
    }, request: request => {
      if (request.action === 'read') payloadRequests.read++;
      return rpc.request('request', { operation: SYNC_OPERATION, request });
    } };
  const destination: SyncHost = { id: 'local', name: '', nativeLocal: true,
    transfer: mode === 'rust-binary' ? transferNativeSync : undefined,
    request: request => {
      if (request.action === 'write') payloadRequests.write++;
      return invoke('codex_conversation_sync', { request });
    } };
  return { source, destination, errors, payloadRequests,
    close: () => { service.release(sessionId); links.client.close(); links.server.close(); rpc.close(); } };
}

export async function nativeChatSyncFixture(options: { mode: Mode; mib: number; runs: number; envelopes?: number }) {
  const batchSizes: Record<string, number> = {};
  const link = await connection(options.mode, packets => {
    const size = String(packets); batchSizes[size] = (batchSizes[size] ?? 0) + 1;
  }, options.envelopes);
  const samples = [];
  try {
    for (let run = 0; run < options.runs; run++) {
      const fixture = await invoke<Fixture>('native_sync_fixture_open', { mib: options.mib });
      let finished = false;
      const responsiveness = eventLoopProbe();
      try {
        await link.source.request({ action: 'resume', id: fixture.source.id, resumeToken: fixture.source.resumeToken! });
        let received = 0;
        const before = link.payloadRequests.read + link.payloadRequests.write;
        const started = performance.now();
        await uploadPreparedSync({ prepared: { id: fixture.destination.id, bundle: fixture.destination,
          plan: { count: 1, duplicateIds: [] }, remote: { host: link.source, bundle: fixture.source } },
          destination: link.destination, signal: new AbortController().signal, progress: (_fraction, bytes) => { received += bytes; } });
        // Legacy transfers verify at this boundary; the binary receiver verifies before its final durable ACK.
        if (options.mode !== 'rust-binary') await invoke('native_sync_fixture_verify', { id: fixture.id });
        const ms = performance.now() - started;
        const payloadRpcRequests = link.payloadRequests.read + link.payloadRequests.write - before;
        if (options.mode === 'rust-binary' && payloadRpcRequests) throw new Error('Native sync fell back to payload RPC');
        await invoke('native_sync_fixture_finish', { id: fixture.id, verify: true }); finished = true;
        if (received !== fixture.source.size || link.errors.length) throw new Error(JSON.stringify({ received, errors: link.errors }));
        samples.push({ run, bytes: received, ms, MiBps: received / 1048576 / (ms / 1000), verified: true,
          maxEventLoopDelayMs: responsiveness.stop(), payloadRpcRequests });
      } finally {
        responsiveness.stop();
        if (!finished) await invoke('native_sync_fixture_finish', { id: fixture.id, verify: false });
      }
    }
    return { mode: options.mode, samples, errors: link.errors, batchSizes };
  } finally { link.close(); }
}
