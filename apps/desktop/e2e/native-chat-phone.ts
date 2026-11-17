import { NativeRtcConnection } from '../src/nativeRtc/connection';
import { runChatPhoneSample, type ChatConfig } from './native-chat-phone-sample';

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
export async function nativeChatPhoneFixture(config: ChatConfig) {
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
      samples.push(await runChatPhoneSample({ channel, config, template, message }, run));
    }
    const stats = Object.fromEntries(await peer.getStats());
    channel.send('finish'); await control('report');
    return { samples, stats, directNativeSend: config.chatCrypto === 'rust' };
  } finally { peer.close(); }
}
