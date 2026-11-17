import { SessionCipher } from '../../../shared/remote-chat/cipher';
import { desktopSessionCrypto } from '../src/remoteChat/sessionCipher';
import { NativeRtcConnection } from '../src/nativeRtc/connection';
import { eventLoopProbe } from './chat-benchmark-metrics';

const control = async (path: string, body?: unknown) => (await fetch(`http://127.0.0.1:18786/${path}`, {
  method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
})).json();
const wait = async (ready: () => boolean) => {
  const deadline = Date.now() + 30000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Chat phone fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
};

/** Public fixture material only; the native case uses the same batched crypto service as desktop chat. */
export async function nativeChatPhoneFixture(config: { runs: number; records: number; chatCrypto: 'js' | 'rust' }) {
  const peer = new NativeRtcConnection({});
  const channel = peer.createDataChannel('codex-chat-v1');
  const messages: Record<string, unknown>[] = [];
  channel.addEventListener('message', event => messages.push(JSON.parse((event as MessageEvent<string>).data)));
  const message = async () => { await wait(() => messages.length > 0); return messages.shift()!; };
  const noise = crypto.getRandomValues(new Uint8Array(16000));
  const template = Array.from(noise, value => String.fromCharCode(33 + value % 90)).join('');
  const samples = [];
  try {
    await peer.setLocalDescription(await peer.createOffer());
    await wait(() => peer.iceGatheringState === 'complete');
    await control('offer', peer.localDescription);
    await peer.setRemoteDescription(await control('answer'));
    await wait(() => channel.readyState === 'open');
    for (let run = 0; run < config.runs; run++) {
      const options = { secret: new Uint8Array(32).fill(7),
        publicKey: '57db4b359f23ae5e146e4e2512056704722506348c150c14753d0c933d04d421',
        sessionId: 'interop-test', desktop: true };
      const cipher = config.chatCrypto === 'rust' ? desktopSessionCrypto.createSessionCipher!(options)
        : new SessionCipher(options);
      if ('handle' in cipher) await cipher.handle;
      channel.send(JSON.stringify({ run, records: config.records, template,
        key: 'a5e489a7d31e8ee806a116c6540a8fde8fec8009390c0141690bd31ad0bc5d44',
        context: 'codex-switch-chat-v1:interop-test' }));
      if ((await message()).ready !== run) throw new Error('Invalid chat readiness');
      let encryptMs = 0, maxBlockingMs = 0;
      const responsiveness = eventLoopProbe();
      const started = performance.now();
      try {
        for (let index = 0; index < config.records; index += 16) {
          const start = performance.now();
          const operations = Array.from({ length: Math.min(16, config.records - index) }, (_, item) => {
            const text = `${run}:${index + item}:${template}`;
            return 'sendDirect' in cipher && cipher.sendDirect
              ? cipher.sendDirect({ ...channel.nativeRtcHandle!, envelopes: 0 }, text) : cipher.encrypt(text);
          });
          maxBlockingMs = Math.max(maxBlockingMs, performance.now() - start);
          const packets = await Promise.all(operations); encryptMs += performance.now() - start;
          for (const payload of packets) {
            if (payload === undefined) continue;
            await wait(() => channel.bufferedAmount < 256 * 1024);
            channel.send(payload);
          }
        }
        const receiver = await message();
        if (receiver.run !== run || receiver.verified !== true) throw new Error('Chat verification failed');
        samples.push({ run, ms: performance.now() - started, encryptMs, maxBlockingMs,
          maxEventLoopDelayMs: responsiveness.stop(), receiver });
      } finally { responsiveness.stop(); cipher.destroy(); options.secret.fill(0); }
    }
    const stats = Object.fromEntries(await peer.getStats());
    channel.send('finish'); await control('report');
    return { samples, stats, directNativeSend: config.chatCrypto === 'rust' };
  } finally { peer.close(); }
}
