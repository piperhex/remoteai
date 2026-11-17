import { invoke } from '@tauri-apps/api/core';
import { SessionCipher } from '../../../shared/remote-chat/cipher';
import type { NativeSessionCipher } from '../../../shared/remote-chat/nativeSessionCipher';
import { desktopSessionCrypto } from '../src/remoteChat/sessionCipher';
import type { NativeRtcConnection } from '../src/nativeRtc/connection';
import { eventLoopProbe } from './chat-benchmark-metrics';

const PROBE_INTERVAL = 128;
type Cipher = SessionCipher | NativeSessionCipher;
export interface ChatConfig {
  runs: number; records: number; chatCrypto: 'js' | 'rust';
  highWaterBytes: number; lowWaterBytes: number; chatWindowCompare?: boolean; chatWindowReverse?: boolean;
  chatBatch?: number; chatProductionWindow?: boolean; chatProbe?: boolean;
}
interface SampleContext {
  channel: ReturnType<NativeRtcConnection['createDataChannel']>;
  config: ChatConfig;
  template: string;
  message: () => Promise<Record<string, unknown>>;
}

async function openCipher(mode: ChatConfig['chatCrypto']) {
  // Public fixture material only, never an account key.
  const options = { secret: new Uint8Array(32).fill(7),
    publicKey: '57db4b359f23ae5e146e4e2512056704722506348c150c14753d0c933d04d421',
    sessionId: 'interop-test', desktop: true };
  const cipher = mode === 'rust' ? desktopSessionCrypto.createSessionCipher!(options) : new SessionCipher(options);
  try {
    if ('handle' in cipher) await cipher.handle;
    return { cipher, secret: options.secret };
  } catch (error) { cipher.destroy(); options.secret.fill(0); throw error; }
}

async function sendBatch(context: SampleContext, cipher: Cipher, range: { run: number; index: number; count: number }) {
  const { channel, template } = context;
  const start = performance.now();
  const operations = Array.from({ length: range.count }, (_, item) => {
    const text = `${range.run}:${range.index + item}:${template}`;
    return 'sendDirect' in cipher && cipher.sendDirect
      ? cipher.sendDirect({ ...channel.nativeRtcHandle!, envelopes: 0 }, text) : cipher.encrypt(text);
  });
  const blockingMs = performance.now() - start;
  const packets = await Promise.all(operations);
  const submitMs = performance.now() - start;
  for (const payload of packets) {
    if (payload === undefined) continue;
    const deadline = Date.now() + 30000;
    while (channel.bufferedAmount >= 256 * 1024) {
      if (Date.now() > deadline) throw new Error('Chat send timed out');
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    channel.send(payload);
  }
  return { blockingMs, submitMs };
}

async function probe(context: SampleContext, cipher: Cipher, run: number, index: number) {
  if (!('sendDirect' in cipher) || !cipher.sendDirect) throw new Error('Probes require native crypto');
  const start = performance.now();
  await cipher.sendDirect({ ...context.channel.nativeRtcHandle!, envelopes: 0 }, `${run}:probe:${index}`);
  const reply = await context.message();
  if (reply.run !== run || reply.probe !== index) throw new Error('Invalid chat probe reply');
  return performance.now() - start;
}

async function sendRecords(context: SampleContext, cipher: Cipher, run: number) {
  const { config } = context;
  const batchSize = config.chatBatch ?? 16;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 96) throw new Error('Invalid chat batch');
  let submitMs = 0, maxBlockingMs = 0;
  const probeMs: number[] = [];
  for (let index = 0; index < config.records; index += batchSize) {
    const count = Math.min(batchSize, config.records - index);
    const batch = await sendBatch(context, cipher, { run, index, count });
    submitMs += batch.submitMs; maxBlockingMs = Math.max(maxBlockingMs, batch.blockingMs);
    if (config.chatProbe && (index + count) % PROBE_INTERVAL === 0 && index + count < config.records) {
      probeMs.push(await probe(context, cipher, run, probeMs.length));
    }
  }
  return { submitMs, maxBlockingMs, probeMs, batchSize };
}

async function measure(context: SampleContext, cipher: Cipher, run: number) {
  const responsiveness = eventLoopProbe();
  const started = performance.now();
  try {
    const sent = await sendRecords(context, cipher, run);
    const receiver = await context.message();
    if (receiver.run !== run || receiver.verified !== true) throw new Error('Chat verification failed');
    const ms = performance.now() - started;
    const maxEventLoopDelayMs = responsiveness.stop();
    const sendStages = await invoke('native_rtc_fixture_channel', {
      request: { ...context.channel.nativeRtcHandle!, reset: false },
    });
    return { run, ms, ...sent, sendStages, maxEventLoopDelayMs, receiver };
  } finally { responsiveness.stop(); }
}

export async function runChatPhoneSample(context: SampleContext, run: number) {
  const { config, channel, template } = context;
  const baseline = (run + (config.chatWindowReverse ? 1 : 0)) % 2 === 0;
  const requestedWindow = config.chatWindowCompare && baseline ? { high: 256 * 1024, low: 64 * 1024 }
    : { high: config.highWaterBytes, low: config.lowWaterBytes };
  const window = config.chatProductionWindow ? null : requestedWindow;
  const target = channel.nativeRtcHandle!;
  await invoke('native_rtc_fixture_channel', { request: { ...target, window, reset: true } });
  const { cipher, secret } = await openCipher(config.chatCrypto);
  try {
    channel.send(JSON.stringify({ run, records: config.records, template,
      probes: config.chatProbe ? Math.floor((config.records - 1) / PROBE_INTERVAL) : 0,
      key: 'a5e489a7d31e8ee806a116c6540a8fde8fec8009390c0141690bd31ad0bc5d44',
      context: 'codex-switch-chat-v1:interop-test' }));
    if ((await context.message()).ready !== run) throw new Error('Invalid chat readiness');
    await invoke('native_rtc_fixture_channel', { request: { ...target, reset: true } });
    return { ...await measure(context, cipher, run), window };
  } finally { cipher.destroy(); secret.fill(0); }
}
