import React from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { RemoteDesktop } from '../../../shared/remote-desktop/views/RemoteDesktop';
import { setNativeDesktopRuntime } from '../../../shared/remote-desktop/runtime';
import type { DesktopClient, DesktopOffer, DesktopSignalReply } from '../../../shared/remote-desktop/protocol';
import { createNativeRtcConnection } from '../src/nativeRtc/connection';
import { nativeVideoCodecs } from '../src/nativeRtc/videoCodec';
import { nativeDataFixture } from './native-rtc-data';
import { nativePhoneFixture } from './native-rtc-phone';
import '../src/styles.css';

const root = createRoot(document.getElementById('root')!);
const sessions = new Map<string, string>();
let selected: 'h264' | 'h265' = 'h264';
let browserRtcCalls = 0;
Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: function () {
  browserRtcCalls += 1; throw new Error('Desktop must not create browser WebRTC');
} });
setNativeDesktopRuntime({ createPeer: config => createNativeRtcConnection(config, true),
  videoCodecs: async () => [selected] });
const client: DesktopClient = {
  open: async id => {
    const offer = await invoke<DesktopOffer & { id: string }>('native_rtc_fixture_open', { codec: selected });
    sessions.set(id, offer.id); return offer;
  },
  signal: (id, signal) => invoke<DesktopSignalReply>('native_rtc_fixture_signal', { id: sessions.get(id), signal }),
  close: async id => {
    const handle = sessions.get(id); sessions.delete(id);
    if (handle) await invoke('native_rtc_fixture_close', { id: handle });
  },
  settings: async () => {},
};
const fixture = {
  data: nativeDataFixture,
  phone: nativePhoneFixture,
  supported: nativeVideoCodecs,
  calls: () => browserRtcCalls,
  start: (codec: 'h264' | 'h265') => {
    selected = codec;
    root.render(<RemoteDesktop client={client} active nativeWindow close={() => fixture.close()} />);
  },
  close: () => root.render(null),
};
Object.assign(window, { nativeRtcFixture: fixture });
