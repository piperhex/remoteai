import type { DesktopStats } from './protocol';
import { isNativeMediaPair, type NativeMediaEndpoint } from './nativeMedia';

type Report = Record<string, unknown>;
export interface DesktopStatsReports { forEach: (callback: (value: unknown) => void) => void }
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const record = (value: unknown): Report => value !== null && typeof value === 'object' ? value as Report : {};
const SECONDS_TO_MS = 1000;
const BITS_PER_BYTE = 8;

function routeStats(reports: Report[], nativeMedia?: NativeMediaEndpoint): Partial<DesktopStats> {
  const selected = reports.find(report => report.type === 'transport')?.selectedCandidatePairId;
  const pair = reports.find(report => report.type === 'candidate-pair'
    && (selected ? report.id === selected : report.nominated && report.state === 'succeeded'));
  if (!pair) return {};
  const local = reports.find(report => report.id === pair.localCandidateId);
  const remote = reports.find(report => report.id === pair.remoteCandidateId);
  const transport = String(local?.relayProtocol ?? local?.protocol ?? '').toUpperCase();
  const network = ({ wifi: 'Wi-Fi', ethernet: 'Ethernet', cellular: 'Cellular' } as const)
    [String(local?.networkType) as 'wifi' | 'ethernet' | 'cellular'];
  const rtt = number(pair.currentRoundTripTime);
  const native = isNativeMediaPair({ local, remote }, nativeMedia);
  return { nativeMedia: native, connection: !native && (local?.candidateType === 'relay' || remote?.candidateType === 'relay')
    ? 'relay' : 'direct',
    rttMs: rtt === undefined ? undefined : rtt * SECONDS_TO_MS,
    transport: transport === 'UDP' || transport === 'TCP' || transport === 'TLS' ? transport : undefined, network };
}

function delta(current: Report, previous: Report | undefined, key: string) {
  const value = number(current[key]); const before = number(previous?.[key]);
  return value === undefined || before === undefined || value < before ? undefined : value - before;
}

/** RTC counters are cumulative; show rates for the latest sample, never the sender's configured limits. */
export class DesktopStatsSampler {
  private previous?: Report;
  constructor(private readonly nativeMedia?: NativeMediaEndpoint) {}
  sample(input: DesktopStatsReports): Partial<DesktopStats> {
    const reports: Report[] = []; input.forEach(value => reports.push(record(value)));
    const video = reports.find(report => report.type === 'inbound-rtp' && (report.kind ?? report.mediaType) === 'video');
    const result = routeStats(reports, this.nativeMedia);
    if (!video) return result;
    const codec = reports.find(report => report.id === video.codecId);
    const mime = String(codec?.mimeType ?? '').toLowerCase();
    if (mime === 'video/h265' || mime === 'video/h264') result.videoCodec = mime === 'video/h265' ? 'h265' : 'h264';
    if (typeof video.powerEfficientDecoder === 'boolean') result.hardwareDecoding = video.powerEfficientDecoder;
    const previous = this.previous?.id === video.id ? this.previous : undefined;
    this.previous = video;
    const milliseconds = delta(video, previous, 'timestamp');
    const frames = delta(video, previous, 'framesDecoded');
    const bytes = delta(video, previous, 'bytesReceived');
    const decode = delta(video, previous, 'totalDecodeTime');
    const received = delta(video, previous, 'packetsReceived');
    const lost = delta(video, previous, 'packetsLost');
    result.receivedFps = milliseconds && frames !== undefined
      ? frames * SECONDS_TO_MS / milliseconds : number(video.framesPerSecond);
    if (milliseconds && bytes !== undefined) result.receivedBitrate = bytes * BITS_PER_BYTE * SECONDS_TO_MS / milliseconds;
    if (frames && decode !== undefined) result.decodeMs = decode * SECONDS_TO_MS / frames;
    if (received !== undefined && lost !== undefined && received + lost > 0) {
      result.lossPercent = lost / (received + lost) * 100;
    }
    const width = number(video.frameWidth); const height = number(video.frameHeight);
    if (width && height) { result.width = width; result.height = height; }
    return result;
  }
}

export function desktopStatsLines(stats: DesktopStats, translate: (text: string) => string = text => text): string[] {
  const elapsed = Math.max(0, Math.floor(number(stats.elapsedSeconds) ?? 0));
  const duration = [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
  const value = (input: unknown, digits = 0) => number(input)?.toFixed(digits) ?? '—';
  const bitrate = number(stats.receivedBitrate);
  const width = number(stats.width); const height = number(stats.height);
  const connection = stats.connection ? translate(stats.connection === 'relay' ? '中继' : '直连') : '—';
  const pipeline = stats.videoCodec || stats.captureMethod ? [
    [stats.captureMethod, stats.videoCodec?.toUpperCase()].filter(Boolean).join(' · '),
  ] : [];
  return [duration, `${stats.transport ?? '—'} ${connection}`, `${value(stats.receivedFps)} fps`,
    `${value(bitrate === undefined ? undefined : bitrate / 1_000_000, 1)} Mbps`,
    `${value(stats.rttMs)} ms ${translate('延迟')}`, `${value(stats.decodeMs)} ms ${translate('解码')}`,
    `${value(stats.lossPercent, 1)}% ${translate('丢包')}`,
    width && height ? `${width} × ${height}` : '—',
    stats.network ? translate(stats.network) : `— ${translate('网络')}`, ...pipeline];
}
