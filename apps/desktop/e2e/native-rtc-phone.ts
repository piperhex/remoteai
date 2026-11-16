import { invoke } from '@tauri-apps/api/core';
import { NativeRtcConnection } from '../src/nativeRtc/connection';
import { NativeBulkSender } from '../src/remoteChat/bulkNativeSender';
import type { ChatLink } from '../../../shared/remote-chat/link';
import { bulkCapability } from '../../../shared/remote-chat/bulkControl';
import type { DownloadManifest } from '../../../shared/remote-chat/downloadManifest';

interface Source {
  id: string; transfer: string; epoch: string; key: string; run: number;
  manifest: DownloadManifest; page: unknown;
}
const control = async (path: string, body?: unknown) => (await fetch(`http://127.0.0.1:18786/${path}`, {
  method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
})).json();
const wait = async (ready: () => boolean) => {
  const deadline = Date.now() + 30000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Native phone fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

/** Adds the actual WebView orchestration and Tauri file-send command to the native stage diagnostic. */
export async function nativePhoneFixture(config: { runs: number; yieldBatches?: boolean }) {
  const peer = new NativeRtcConnection({});
  const channel = peer.createDataChannel('remote-ai-file-v1', { negotiated: true, id: 42 });
  const messages: Record<string, unknown>[] = [];
  channel.addEventListener('message', event => messages.push(JSON.parse((event as MessageEvent<string>).data)));
  const message = async () => { await wait(() => messages.length > 0); return messages.shift()!; };
  const samples = [];
  try {
    await peer.setLocalDescription(await peer.createOffer());
    await wait(() => peer.iceGatheringState === 'complete');
    await control('offer', peer.localDescription);
    await peer.setRemoteDescription(await control('answer'));
    await wait(() => channel.readyState === 'open');
    for (let run = 0; run < config.runs; run += 1) {
      const source = await invoke<Source>('native_rtc_file_fixture_open', { run });
      // A public diagnostic key isolates payload cost from the separately tested account handshake.
      const link = { connectionMode: 'direct', createBulkCipher: () => ({
        takeSenderMaterial: () => ({ key: new Uint8Array(32).fill(7) }),
      }) } as unknown as ChatLink;
      const sender = await NativeBulkSender.open({ link, manifestId: source.manifest.manifestId,
        recordBytes: 16384, open: { transferId: source.transfer, id: source.id, epoch: source.epoch,
          path: 'direct', capability: bulkCapability('synced-file') } });
      try {
        channel.send(JSON.stringify(source));
        if ((await message()).ready !== run) throw new Error('Invalid readiness response');
        const started = performance.now();
        for (let block = 0; block < source.manifest.blockCount; block += 1) {
          const requestId = crypto.randomUUID();
          for (let offset = 0; offset < 1048576; offset += 16 * (16384 - 88)) {
            await sender.sendDirect({ block, offset, requestId }, channel.nativeRtcHandle!, () => {});
            if (config.yieldBatches) await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
        const receiver = await message();
        if (receiver.run !== run || receiver.verified !== true) throw new Error('File verification failed');
        samples.push({ run, ms: performance.now() - started, receiver });
      } finally {
        sender.destroy();
        await invoke('native_rtc_file_fixture_close', { id: source.id, transfer: source.transfer });
      }
    }
    const stats = Object.fromEntries(await peer.getStats());
    channel.send('finish'); await control('report');
    return { samples, stats };
  } finally { peer.close(); }
}
