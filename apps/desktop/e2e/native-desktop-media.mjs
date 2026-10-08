// Invoked by the Rust media adapter integration test; all endpoints are ephemeral and local.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const endpoints = JSON.parse(input);
for (const multipleInterfaces of [false, true]) await verifyMedia(multipleInterfaces);

async function verifyMedia(multipleInterfaces) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: multipleInterfaces ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : [] });
  const deadline = setTimeout(() => { void browser.close(); }, 45_000);
  try { await exchangeMedia(browser, multipleInterfaces); }
  finally { clearTimeout(deadline); await browser.close(); }
}

async function exchangeMedia(browser, multipleInterfaces) {
  const page = await browser.newPage();
  if (multipleInterfaces) {
    await page.route('https://native-media.test/', route => route.fulfill({ body: '<html></html>' }));
    await page.goto('https://native-media.test/');
  }
  await page.setContent('<canvas width="320" height="180"></canvas><video autoplay muted></video>');
  const result = await page.evaluate(async ({ endpoints, multipleInterfaces }) => {
    if (multipleInterfaces) {
      const devices = await navigator.mediaDevices.getUserMedia({ audio: true });
      devices.getTracks().forEach(track => track.stop());
    }
    const peers = endpoints.map(endpoint => new RTCPeerConnection({
      iceServers: [{ ...endpoint, urls: endpoint.urls.filter(url => multipleInterfaces || url.endsWith('=udp')) }],
      iceTransportPolicy: multipleInterfaces ? 'all' : 'relay',
    }));
    const [host, viewer] = peers;
    const iceErrors = [];
    peers.forEach(peer => { peer.onicecandidateerror = event => iceErrors.push({ code: event.errorCode,
      text: event.errorText }); });
    const canvas = document.querySelector('canvas');
    const paint = canvas.getContext('2d');
    const video = document.querySelector('video');
    const media = canvas.captureStream(30);
    const audio = new AudioContext();
    const output = audio.createMediaStreamDestination();
    const tone = audio.createOscillator(); tone.connect(output); tone.start(); await audio.resume();
    for (const track of [...media.getTracks(), ...output.stream.getTracks()]) host.addTrack(track, media);
    const controls = host.createDataChannel('remote-desktop-controls');
    let receivedControl = '';
    viewer.ondatachannel = event => { event.channel.onmessage = message => { receivedControl = message.data; }; };
    viewer.ontrack = event => { video.srcObject = event.streams[0]; void video.play(); };
    const gather = peer => new Promise(resolve => {
      const finish = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); resolve(); };
      const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
      // Broken interface-bound UDP gathering may outlast the healthy local TCP allocation.
      const timer = setTimeout(finish, 5000);
      peer.addEventListener('icegatheringstatechange', changed); changed();
    });
    // Both fixtures share one machine; exclude host shortcuts that could hide a broken adapter.
    const nativeDescription = peer => ({ type: peer.localDescription.type,
      sdp: peer.localDescription.sdp.split('\r\n').filter(line => !line.startsWith('a=candidate:')
        || line.includes(' typ relay ')).join('\r\n') });
    await host.setLocalDescription(await host.createOffer()); await gather(host);
    await viewer.setRemoteDescription(nativeDescription(host));
    await viewer.setLocalDescription(await viewer.createAnswer()); await gather(viewer);
    await host.setRemoteDescription(nativeDescription(viewer));
    const started = Date.now();
    let receivedVideo = 0; let receivedAudio = 0; let selected;
    while (Date.now() - started < 20_000) {
      paint.fillStyle = `hsl(${Date.now() % 360}, 80%, 50%)`; paint.fillRect(0, 0, canvas.width, canvas.height);
      if (controls.readyState === 'open') controls.send('native controls');
      const reports = await viewer.getStats();
      for (const report of reports.values()) {
        if (report.type === 'inbound-rtp' && report.kind === 'video') receivedVideo = report.framesDecoded;
        if (report.type === 'inbound-rtp' && report.kind === 'audio') receivedAudio = report.packetsReceived;
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          const pair = reports.get(report.selectedCandidatePairId);
          selected = { local: reports.get(pair.localCandidateId)?.address,
            remote: reports.get(pair.remoteCandidateId)?.address };
        }
      }
      if (receivedVideo > 5 && receivedAudio > 5 && receivedControl) break;
      await new Promise(resolve => setTimeout(resolve, 33));
    }
    const states = peers.map(peer => ({ state: peer.connectionState,
      hostCandidates: peer.localDescription.sdp.split('\r\n')
        .filter(line => line.startsWith('a=candidate:') && line.includes(' typ host ')).length }));
    peers.forEach(peer => peer.close()); media.getTracks().forEach(track => track.stop()); await audio.close();
    return { receivedVideo, receivedAudio, receivedControl, selected, states, iceErrors };
  }, { endpoints, multipleInterfaces });
  assert(result.receivedVideo > 5, JSON.stringify(result));
  assert(result.receivedAudio > 5, JSON.stringify(result));
  assert.equal(result.receivedControl, 'native controls');
  assert.deepEqual(result.selected, { local: '10.253.0.2', remote: '10.253.0.1' });
  if (multipleInterfaces) assert(result.states.every(state => state.hostCandidates > 0), JSON.stringify(result));
  console.log(JSON.stringify({ multipleInterfaces, ...result }));
  await page.close();
}
