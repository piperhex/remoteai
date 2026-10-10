import type { IceServer } from '../remote-chat/protocol';

export const DESKTOP_OPERATION = 'remoteDesktop';
export const MAX_FPS = 144;
const MIN_RESOLUTION_DIMENSION = 320;
const MAX_RESOLUTION_DIMENSION = 8192;
export const DEFAULT_SETTINGS: DesktopSettings = { fps: 'auto', quality: 'auto' };
export type DesktopQuality = 'auto' | 'smooth' | 'clear' | 'original';
export type DesktopVideoCodec = 'h264' | 'h265';
export interface DesktopSettings {
  fps: 'auto' | number; quality: DesktopQuality; displayId?: string; clipboardChannel?: boolean;
  nativeMedia?: boolean; relayStandby?: boolean;
  videoCodecs?: DesktopVideoCodec[];
}
export interface DesktopDisplay { id: string; name: string; width: number; height: number; primary: boolean }
export interface DesktopPermissions {
  enabled: boolean; control: boolean; clipboardRead: boolean; clipboardWrite: boolean; files: boolean; audio: boolean;
}
export type DesktopPlatform = 'windows' | 'macos';
export type DesktopSystemPermission = 'screenRecording' | 'accessibility';
export interface DesktopPermissionStatus { required: DesktopSystemPermission | null }
export interface DesktopDisplays {
  resolutions?: DesktopResolution[];
  privacyScreen?: boolean;
  displays?: DesktopDisplay[]; displayId?: string; permissions?: DesktopPermissions; platform?: DesktopPlatform;
}
export interface DesktopResolution { width: number; height: number }
export interface DesktopCapabilities {
  resolution?: boolean;
  privacyScreen?: boolean;
  platform?: DesktopPlatform;
  keyboard?: boolean; clipboard?: boolean; horizontalScroll?: boolean; control?: boolean;
}
export interface DesktopOffer extends DesktopDisplays {
  sdp: string; iceServers: IceServer[]; capabilities?: DesktopCapabilities; directUpgrade?: boolean;
  nativeMedia?: boolean; relayStandby?: boolean;
}
export interface DirectUpgrade { generation: number; action: 'start' | 'signal' | 'commit' | 'cancel' }
export interface DesktopSignal {
  answer?: string; candidates: RTCIceCandidateInit[]; directUpgrade?: DirectUpgrade; relayStandby?: DirectUpgrade;
}
export interface DesktopSignalReply {
  candidates: RTCIceCandidateInit[]; sdp?: string; generation?: number; committed?: boolean;
}
export interface DesktopStats {
  videoCodec?: DesktopVideoCodec; captureMethod?: 'DXGI' | 'WGC' | 'GDI';
  hardwareEncoding?: boolean; hardwareDecoding?: boolean;
  nativeMedia?: boolean;
  audio?: 'starting' | 'playing' | 'unavailable';
  fps: number; width: number; height: number; bitrate: number; connection?: 'direct' | 'relay';
  receivedFps?: number; receivedBitrate?: number; elapsedSeconds?: number;
  decodedFrames?: number;
  rttMs?: number; decodeMs?: number; lossPercent?: number;
  transport?: 'UDP' | 'TCP' | 'TLS'; network?: 'Wi-Fi' | 'Ethernet' | 'Cellular';
}
export type DesktopInput =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'button'; button: 'left' | 'right' | 'middle'; down: boolean }
  | { kind: 'wheel'; delta: number; horizontal?: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'keyboard'; code: string; down: boolean }
  | { kind: 'key'; key: 'enter' | 'backspace' | 'escape' | 'tab' | 'desktop' | 'windows' };
export interface DesktopClient {
  permissionStatus?(): Promise<DesktopPermissionStatus>;
  nativeMedia?: import('./nativeMedia').NativeMediaFactory;
  diagnostic?: import('../remote-chat/diagnostics').ConnectionDiagnostic;
  open(id: string, settings: DesktopSettings): Promise<DesktopOffer>;
  signal(id: string, signal: DesktopSignal): Promise<DesktopSignalReply>;
  settings(id: string, settings: DesktopSettings): Promise<void>;
  privacy?(id: string, enabled: boolean): Promise<DesktopDisplays>;
  resolution?(id: string, resolution: DesktopResolution): Promise<DesktopDisplays>;
  close(id: string): Promise<void>;
}

export function desktopClient(request: <T>(body: object) => Promise<T>,
  diagnostic?: import('../remote-chat/diagnostics').ConnectionDiagnostic,
  nativeMedia?: import('./nativeMedia').NativeMediaFactory): DesktopClient {
  const call = <T>(action: string, body: object) => request<T>({ operation: DESKTOP_OPERATION, action, ...body });
  return {
    diagnostic,
    nativeMedia,
    permissionStatus: () => call('permissions', {}),
    open: (id, settings) => call('open', { id, settings }),
    signal: (id, signal) => call('signal', { id, ...signal }),
    settings: (id, settings) => call('settings', { id, settings }),
    privacy: (id, enabled) => call('privacy', { id, enabled }),
    resolution: (id, resolution) => call('resolution', { id, resolution }),
    close: id => call('close', { id }),
  };
}

export function validateResolution(value: unknown): DesktopResolution {
  const size = value as Partial<DesktopResolution> | null;
  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height)
    || size.width! < MIN_RESOLUTION_DIMENSION || size.height! < MIN_RESOLUTION_DIMENSION
    || size.width! > MAX_RESOLUTION_DIMENSION || size.height! > MAX_RESOLUTION_DIMENSION) {
    throw new Error('请选择有效的分辨率。');
  }
  return { width: size.width!, height: size.height! };
}

export function validateSettings(value: unknown): DesktopSettings {
  const input = value as Partial<DesktopSettings> | null;
  if (!input || !['auto', 'smooth', 'clear', 'original'].includes(String(input.quality))) {
    throw new Error('请选择有效的画质。');
  }
  if (input.fps !== 'auto' && (!Number.isInteger(input.fps) || Number(input.fps) < 1 || Number(input.fps) > MAX_FPS)) {
    throw new Error(`帧率应为 1–${MAX_FPS} 的整数。`);
  }
  if (input.displayId !== undefined && (typeof input.displayId !== 'string'
    || !input.displayId.length || input.displayId.length > 128)) {
    throw new Error('请选择有效的显示器。');
  }
  if (input.videoCodecs !== undefined && (!Array.isArray(input.videoCodecs) || input.videoCodecs.length > 2
    || input.videoCodecs.some(codec => codec !== 'h264' && codec !== 'h265')
    || !input.videoCodecs.includes('h264'))) throw new Error('桌面连接信息无效，请重新连接。');
  return { fps: input.fps!, quality: input.quality!,
    ...(input.videoCodecs ? { videoCodecs: [...new Set(input.videoCodecs)] } : {}),
    ...(input.nativeMedia === true ? { nativeMedia: true } : {}),
    ...(input.relayStandby === true ? { relayStandby: true } : {}),
    ...(input.clipboardChannel === true ? { clipboardChannel: true } : {}),
    ...(input.displayId === undefined ? {} : { displayId: input.displayId }) };
}
