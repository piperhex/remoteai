export interface QuotaEstimate {
  capacityUsd: number | null;
  remainingUsd: number | null;
  consumedUsd: number;
  declinePercent: number;
  startPercent: number | null;
  remainingPercent: number | null;
  startTs: number;
  endTs: number;
}
export interface OfficialDeviceTotal {
  deviceId: string; deviceName: string; tokens: number; costUsd: number; updatedAt: number;
}
export interface OfficialAccountTotal {
  accountId: string;
  accountLabel: string;
  tokens: number;
  costUsd: number;
  remainingUsd: number | null;
  primary: QuotaEstimate | null;
  secondary: QuotaEstimate | null;
  devices: OfficialDeviceTotal[];
}
export interface OfficialUsageSummary {
  accounts: OfficialAccountTotal[];
  status: 'ready' | 'signedOut' | 'unavailable';
  updatedAt: number;
}
