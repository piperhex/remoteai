export interface RemoteLossReport {
  id: string; timestamp: number; fractionLost?: number; roundTripTimeMeasurements?: number;
}
const BITS_PER_BYTE = 8;
const MILLISECONDS_PER_SECOND = 1000;

/** Sample actual video traffic and consume each remote report once, even across repeated getStats calls. */
export class DesktopNetworkSampler {
  private outbound?: { id: string; bytes: number; timestamp: number };
  private lossReport?: string;

  sentBitrate(report: RTCOutboundRtpStreamStats): number | undefined {
    const previous = this.outbound;
    if (report.bytesSent === undefined || !Number.isFinite(report.timestamp)) return;
    this.outbound = { id: report.id, bytes: report.bytesSent, timestamp: report.timestamp };
    if (!previous || previous.id !== report.id || report.timestamp <= previous.timestamp
      || report.bytesSent < previous.bytes) return;
    return (report.bytesSent - previous.bytes) * BITS_PER_BYTE * MILLISECONDS_PER_SECOND
      / (report.timestamp - previous.timestamp);
  }

  loss(report: RemoteLossReport): number | undefined {
    const sequence = report.roundTripTimeMeasurements && report.roundTripTimeMeasurements > 0
      ? report.roundTripTimeMeasurements : report.timestamp;
    const key = `${report.id}:${sequence}`;
    if (key === this.lossReport || !Number.isFinite(report.fractionLost)) return;
    this.lossReport = key;
    return report.fractionLost;
  }

  reset() { this.outbound = undefined; this.lossReport = undefined; }
}
