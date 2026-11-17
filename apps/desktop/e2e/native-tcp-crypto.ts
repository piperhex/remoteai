import { x25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';
import { TcpChannel } from '../../../shared/remote-chat/tcp/channel';
import type { TcpSocket } from '../../../shared/remote-chat/tcp/types';
import { DesktopTcpChannel } from '../src/remoteChat/tcpChannel';

function sockets() {
  const receivers: Array<((bytes: Uint8Array) => void) | undefined> = [];
  const pending: Uint8Array[][] = [[], []];
  const closed = [false, false];
  return [0, 1].map(side => ({
    localAddress: '192.0.2.1', localPort: 40000 + side, bufferedAmount: 0,
    write(bytes: Uint8Array) {
      queueMicrotask(() => {
        const other = 1 - side;
        if (closed[side] || closed[other]) return;
        for (const part of [bytes.slice(0, 2), bytes.slice(2, 11), bytes.slice(11)].filter(part => part.length)) {
          if (receivers[other]) receivers[other]!(part); else pending[other].push(part);
        }
      });
    },
    onData(callback: (bytes: Uint8Array) => void) {
      receivers[side] = callback; pending[side].splice(0).forEach(callback);
    },
    onClose() {}, close() { closed[side] = true; },
  } satisfies TcpSocket));
}

/** Real Rust IPC codec against the unmodified legacy JS peer, including fragmented headers. */
export async function nativeTcpCryptoFixture() {
  const results = [];
  for (const desktop of [true, false]) {
    const [left, right] = sockets(), secret = new Uint8Array(32).fill(7), remote = new Uint8Array(32).fill(9);
    const native = new DesktopTcpChannel({ socket: left, secret,
      publicKey: bytesToHex(x25519.getPublicKey(remote)), sessionId: 'tcp-interop', desktop });
    const legacy = new TcpChannel({ socket: right, key: x25519.getSharedSecret(remote, x25519.getPublicKey(secret)),
      sessionId: 'tcp-interop', desktop: !desktop, random: size => crypto.getRandomValues(new Uint8Array(size)) });
    const fromNative: string[] = [], fromLegacy: string[] = [];
    legacy.onMessage(text => fromNative.push(text)); native.onMessage(text => fromLegacy.push(text));
    const wait = async (ready: () => boolean) => {
      const deadline = Date.now() + 10000;
      while (!ready()) {
        if (Date.now() > deadline) throw new Error('TCP interoperability timed out');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    try {
      await wait(() => native.readyState === 'open' && legacy.readyState === 'open');
      const text = '聊天同步 😀'.repeat(1000);
      for (let index = 0; index < 8; index++) { native.send(text + index); legacy.send(text + index); }
      await wait(() => fromNative.length === 8 && fromLegacy.length === 8);
      if (fromNative.some((value, index) => value !== text + index)
        || fromLegacy.some((value, index) => value !== text + index)) throw new Error('TCP plaintext mismatch');
      results.push({ desktop, messagesPerDirection: 8, verified: true });
    } finally { native.close(); legacy.close(); secret.fill(0); remote.fill(0); }
  }
  return results;
}
