// Served only by benchmark-android-data-channel.mjs to a temporary bundled Chromium page.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, description) {
  const deadline = performance.now() + 60000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${description}`);
    await delay(10);
  }
}

async function selectedRoute(peer) {
  const stats = await peer.getStats();
  const transport = [...stats.values()].find((item) => item.type === 'transport');
  const pair = stats.get(transport?.selectedCandidatePairId);
  return { pair, local: stats.get(pair?.localCandidateId), remote: stats.get(pair?.remoteCandidateId) };
}

async function drain(channel) {
  if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Data channel drain timed out')), 30000);
    const low = () => finish();
    const closed = () => finish(new Error('Data channel closed'));
    function finish(error) {
      clearTimeout(timeout);
      channel.removeEventListener('bufferedamountlow', low);
      channel.removeEventListener('close', closed);
      if (error) reject(error); else resolve();
    }
    channel.addEventListener('bufferedamountlow', low);
    channel.addEventListener('close', closed);
    if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) finish();
  });
}

async function sendRun(channel, config, run) {
  const buffer = new Uint8Array(config.recordBytes).fill(37);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x52425431); view.setUint32(4, run); view.setUint32(12, config.records);
  let response;
  const receive = (event) => { response = JSON.parse(event.data); };
  channel.addEventListener('message', receive);
  let sendMs = 0; let waitMs = 0; let waits = 0;
  const waitHistogram = {};
  const started = performance.now();
  try {
    for (let sequence = 0; sequence < config.records; sequence += 1) {
      if (channel.bufferedAmount + buffer.length > config.highWaterBytes) {
        const waiting = performance.now();
        await drain(channel);
        const elapsed = performance.now() - waiting;
        waitMs += elapsed; waits += 1;
        const bucket = Math.floor(elapsed);
        waitHistogram[bucket] = (waitHistogram[bucket] ?? 0) + 1;
      }
      view.setUint32(8, sequence);
      const sending = performance.now();
      channel.send(buffer);
      sendMs += performance.now() - sending;
    }
    await waitFor(() => response, 'receiver acknowledgement');
    if (response.run !== run) throw new Error('Unexpected benchmark acknowledgement');
    return { run, ms: performance.now() - started, sendMs, waitMs, waits, waitHistogram, receiver: response };
  } finally { channel.removeEventListener('message', receive); }
}

export async function benchmark(config) {
  const pulse = config.pulseTimer ? setInterval(() => {}, 1) : undefined;
  const peer = new RTCPeerConnection({ iceServers: [] });
  const channel = peer.createDataChannel('transport-benchmark', { ordered: true });
  channel.bufferedAmountLowThreshold = config.lowWaterBytes;
  try {
    await peer.setLocalDescription(await peer.createOffer());
    await waitFor(() => peer.iceGatheringState === 'complete', 'ICE gathering');
    await fetch('/offer', { method: 'POST', body: JSON.stringify(peer.localDescription) });
    const answer = await (await fetch('/answer')).json();
    await peer.setRemoteDescription(answer);
    await waitFor(() => channel.readyState === 'open', 'data channel open');
    const samples = [];
    for (let run = 0; run < config.runs; run += 1) samples.push(await sendRun(channel, config, run));
    const route = await selectedRoute(peer);
    channel.send('finish');
    await (await fetch('/report')).json();
    return { samples, route };
  } finally { clearInterval(pulse); channel.close(); peer.close(); }
}
