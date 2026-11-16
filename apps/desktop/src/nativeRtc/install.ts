import { isTauri } from '@tauri-apps/api/core';
import { setNativeDesktopRuntime } from '../../../../shared/remote-desktop/runtime';
import { createNativeRtcConnection } from './connection';
import { nativeVideoCodecs } from './videoCodec';

if (isTauri()) setNativeDesktopRuntime({
  createPeer: configuration => createNativeRtcConnection(configuration, true), videoCodecs: nativeVideoCodecs,
});
if (import.meta.hot) import.meta.hot.dispose(() => setNativeDesktopRuntime(undefined));
