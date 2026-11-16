import { afterEach, expect, it, vi } from 'vitest';
import { createDesktopPeerConnection, setNativeDesktopRuntime } from '../../../../shared/remote-desktop/runtime';

afterEach(() => { setNativeDesktopRuntime(undefined); vi.unstubAllGlobals(); });

it('fails closed in a Tauri view until its native runtime is installed', () => {
  const browser = vi.fn();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} }); vi.stubGlobal('RTCPeerConnection', browser);
  expect(() => createDesktopPeerConnection({})).toThrow('PATH_UNAVAILABLE');
  expect(browser).not.toHaveBeenCalled();
  const native = {} as RTCPeerConnection;
  const createPeer = vi.fn(() => native);
  setNativeDesktopRuntime({ createPeer, videoCodecs: async () => ['h264'] });
  expect(createDesktopPeerConnection({ iceTransportPolicy: 'relay' })).toBe(native);
  expect(createPeer).toHaveBeenCalledWith({ iceTransportPolicy: 'relay' });
});

it('preserves browser RTC for the standalone Web application', () => {
  const browser = vi.fn(function () {});
  vi.stubGlobal('window', {}); vi.stubGlobal('RTCPeerConnection', browser);
  createDesktopPeerConnection({}); expect(browser).toHaveBeenCalledWith({});
});
