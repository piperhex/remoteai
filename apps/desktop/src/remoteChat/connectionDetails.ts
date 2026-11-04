import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';
import type { RelayUsage } from '../../../../shared/remote-chat/relayUsage';
import { uiText } from "../../../../shared/localization/uiText";

export interface ConnectedDevice {
  id: string;
  name: string;
  platform: string;
  connectedAt: number;
  mode: ConnectionMode;
  uploadBytes?: number;
  downloadBytes?: number;
}
export interface ConnectionDetails { devices: ConnectedDevice[]; usage?: RelayUsage; blocked: boolean }

let snapshot: ConnectionDetails = { devices: [], blocked: false };
const listeners = new Set<() => void>();
function publish(value: ConnectionDetails) {
  snapshot = value;
  listeners.forEach((listener) => listener());
}

export const connectionDetails = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  open(id: string, info: unknown) {
    const data = (info && typeof info === 'object' ? info : {}) as Record<string, unknown>;
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.slice(0, 80) : uiText("client.remoteHostData.otherDevice");
    const platform = typeof data.platform === 'string' ? data.platform.slice(0, 80) : '';
    publish({ ...snapshot, devices: [...snapshot.devices.filter((device) => device.id !== id),
      { id, name, platform, connectedAt: Date.now(), mode: 'connecting' }] });
  },
  update(id: string, changes: Partial<ConnectedDevice>) {
    publish({ ...snapshot, devices: snapshot.devices.map((device) => (
      device.id === id ? { ...device, ...changes } : device)) });
  },
  traffic(id: string, data: Record<string, unknown>) {
    if (!Number.isSafeInteger(data.uploadBytes) || Number(data.uploadBytes) < 0
      || !Number.isSafeInteger(data.downloadBytes) || Number(data.downloadBytes) < 0) return;
    this.update(id, { uploadBytes: Number(data.uploadBytes), downloadBytes: Number(data.downloadBytes) });
  },
  quota(usage: RelayUsage | undefined, blocked: boolean) { publish({ ...snapshot, usage, blocked }); },
  remove(id: string) { publish({ ...snapshot, devices: snapshot.devices.filter((device) => device.id !== id) }); },
  reset() { publish({ devices: [], blocked: false }); },
};
