import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { Text } from 'react-native';
import { DeviceManagementList } from '../src/devices/DeviceManagementList';
import { useDeviceScreenControl } from '../../../shared/remote-desktop/useDeviceScreenControl';
import { textMetrics } from '../src/theme/text';
import { t } from '../src/i18n';
import type { RemoteDevice } from '../src/types';

const devices: RemoteDevice[] = [{ deviceId: 'computer', name: '工作电脑', platform: 'Windows', online: true,
  capabilities: ['screen-power'], localProxyRunning: false, lastSeenAt: '2026-10-23T00:00:00Z' }];

function DeviceScreenFixture() {
  const [fonts] = useFonts(Ionicons.font);
  const [result, setResult] = useState('');
  const screen = useDeviceScreenControl({ scope: 'fixture', request: async () => undefined,
    notify: key => setResult(t(key)) });
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1 }}>
    <Text style={textMetrics(14, 22)}>{result}</Text>
    {fonts && <DeviceManagementList devices={devices} accounts={[]} providers={[]} refreshing={false}
      onBack={() => {}}
      deletingDeviceId={null} switchingModelDeviceId={null} switchingAuthDeviceId={null}
      onRefresh={async () => {}} onSwitchModel={() => {}} onSelectAuthAccount={() => {}}
      onDelete={() => {}} onRevokeService={() => {}} onScreenControl={screen} />}
  </SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(DeviceScreenFixture);
