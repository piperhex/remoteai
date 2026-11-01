import { Provider } from 'react-redux';
import { DeviceManagementList } from '../src/devices/DeviceManagementList';
import { useDeviceScreenControl } from '../src/devices/useDeviceScreenControl';
import { setActiveSession } from '../src/api';
import { store } from '../src/store';
import type { RemoteDevice } from '../src/types';

const devices: RemoteDevice[] = [
  { deviceId: 'computer', name: '工作电脑', platform: 'Windows', online: true },
  { deviceId: 'offline', name: '离线电脑', platform: 'Windows', online: false },
  { deviceId: 'mac', name: 'Mac', platform: 'macOS', online: true },
].map(device => ({ ...device, capabilities: ['screen-power'], localProxyRunning: false,
  lastSeenAt: '2026-10-23T00:00:00Z' }));

function Devices() {
  const screenControl = useDeviceScreenControl();
  return <DeviceManagementList devices={devices} accounts={[]} providers={[]} refreshing={false}
    onBack={() => {}}
    deletingDeviceId={null} switchingModelDeviceId={null} switchingAuthDeviceId={null}
    onRefresh={async () => {}} onSwitchModel={() => {}} onSelectAuthAccount={() => {}}
    onDelete={() => {}} onRevokeService={() => {}} onScreenControl={screenControl} />;
}

export function DeviceScreenHarness() {
  setActiveSession({ baseUrl: location.origin, email: 'screen@example.test',
    accessToken: 'fixture', refreshToken: 'fixture' });
  return <Provider store={store}><main><Devices /></main></Provider>;
}
