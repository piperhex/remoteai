import { ChatConnection } from '../shared/remote-chat/client/connection';
import { RtcPeer } from '../shared/remote-chat/rtcPeer';
import { browserTrustStore, trustedHost, trustScope } from '../shared/remote-chat/trustedHost';
import { chatHandshake } from '../shared/remote-chat/handshake';
import { transferDownload } from '../shared/downloads/transfer';
import { deleteDownload } from '../shared/downloads/storage';
import { recentDownloadMeasurements } from '../shared/remote-chat/downloadMetrics';
import { getChatPolicy } from '../shared/remote-chat/policy';
import type { DownloadClient } from '../shared/remote-chat/downloads';
import type { DownloadTask } from '../shared/downloads/types';
import type { ConnectionMode } from '../shared/remote-chat/protocol';

interface Options {
  baseUrl: string; accessToken: string; deviceId: string; path: string; runs: number; expectedHash: string;
}
const wait = () => new Promise(resolve => setTimeout(resolve, 100));

async function transportStats(peers: RTCPeerConnection[]) {
  const rows = [];
  for (const pc of peers) {
    if (pc.connectionState !== 'connected') continue;
    const report = await pc.getStats();
    const values = [...report.values()];
    const transport = values.find(value => value.type === 'transport' && value.selectedCandidatePairId);
    const pair = transport && report.get(transport.selectedCandidatePairId);
    const candidate = (id: string) => {
      const value = report.get(id);
      return value && { address: value.address, port: value.port, protocol: value.protocol,
        candidateType: value.candidateType };
    };
    rows.push({ state: pc.connectionState,
      channels: values.filter(value => value.type === 'data-channel').map(value => ({
        label: value.label, bytesReceived: value.bytesReceived, bytesSent: value.bytesSent })),
      pair: pair && { local: candidate(pair.localCandidateId), remote: candidate(pair.remoteCandidateId),
        bytesReceived: pair.bytesReceived, rtt: pair.currentRoundTripTime } });
  }
  return rows;
}

async function download(options: Options & { connection: ChatConnection; mode: () => ConnectionMode }) {
  const { connection } = options;
  const request = <T>(body: object) => connection.request<T>('request', body);
  const client: DownloadClient = {
    bulk: connection.downloadsBulk,
    open: body => request({ operation: 'downloadOpen', ...body }),
    browse: body => request({ operation: 'downloadBrowse', ...body }),
    read: body => request({ operation: 'fileRead', ...body }),
    close: (transferId, id) => request({ operation: 'fileClose', threadId: transferId, id }),
  };
  const task: DownloadTask = { id: crypto.randomUUID(), name: 'benchmark.bin', size: 0, received: 0,
    createdAt: Date.now(), status: 'queued', message: '', source: { owner: 'benchmark',
      deviceId: options.deviceId, deviceName: 'Benchmark peer', scope: 'computer', path: options.path } };
  let started = 0, finished = 0, last = task;
  try {
    await transferDownload({ task, client, signal: AbortSignal.timeout(180_000), mode: options.mode,
      update: value => {
        last = value;
        if (value.status === 'downloading' && !started) started = performance.now();
        if (value.status === 'verifying') finished = performance.now();
      } });
    if (!last.verified || last.manifest?.fileHash.toLowerCase() !== options.expectedHash.toLowerCase()) {
      throw new Error('The received file did not pass the independent source hash check.');
    }
    if (connection.downloadsBulk.path() !== 'direct') throw new Error('The file path changed away from P2P.');
    return { bytes: last.received, downloadMs: finished - started,
      MiBps: last.received / 1_048_576 / ((finished - started) / 1000), verified: last.verified,
      protocol: last.protocol, filePath: connection.downloadsBulk.path(),
      metrics: recentDownloadMeasurements().at(-1) };
  } finally { await deleteDownload(task.id); }
}

/** Real authenticated downloads only; no policy overrides or emulated transport. */
export async function run(options: Options) {
  const peers: RTCPeerConnection[] = [];
  let ready = false, issue = '', mode: ConnectionMode = 'offline';
  const connection = new ChatConnection({ deviceId: options.deviceId,
    authorize: async () => ({ baseUrl: options.baseUrl, accessToken: options.accessToken }),
    verifyHostKey: trustedHost(browserTrustStore, trustScope(options.baseUrl, options.deviceId)),
    randomBytes: size => crypto.getRandomValues(new Uint8Array(size)),
    mode: value => { mode = value; }, ready: () => { ready = true; }, event: () => {},
    error: value => { issue = value; },
    createPeer: input => new RtcPeer(input, () => {
      const pc = new RTCPeerConnection({ iceServers: input.iceServers }); peers.push(pc); return pc;
    }),
  });
  connection.start();
  try {
    const deadline = Date.now() + 60_000;
    while (!ready && !issue && Date.now() < deadline) await wait();
    if (!ready) throw new Error(issue || 'Connection timed out');
    connection.setBulkSupport(await connection.request('connect', chatHandshake));
    while (connection.downloadsBulk.path() !== 'direct' && Date.now() < deadline) await wait();
    if (!connection.downloadsBulk.available() || connection.downloadsBulk.path() !== 'direct') {
      throw new Error(`P2P bulk is unavailable (mode=${mode}, bulkPolicy=${getChatPolicy().fileBulkEnabled}).`);
    }
    console.info('P2P_BENCHMARK connected');
    const samples = [];
    for (let index = 0; index < options.runs; index++) {
      const sample = await download({ ...options, connection, mode: () => mode });
      samples.push({ ...sample, transport: await transportStats(peers) });
      console.info(`P2P_BENCHMARK run ${index + 1}: ${sample.MiBps.toFixed(2)} MiB/s; verified`);
    }
    return { capturedAt: new Date().toISOString(), receiver: 'Chromium production shared downloader', samples };
  } finally { connection.stop(); }
}
