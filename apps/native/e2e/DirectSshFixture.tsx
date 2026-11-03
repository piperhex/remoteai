import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Button, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { SshPage } from '../src/discovery/SshPage';
import { DiscoveryPage } from '../src/discovery/DiscoveryPage';
import { BottomNavigation } from '../src/discovery/BottomNavigation';
import { updateThemeMode, useThemeColor } from '../src/theme/store';
import { textMetrics } from '../src/theme/text';
import { ThemeStatusBar } from '../src/theme/ThemeStatusBar';
import { reportDirectSshFailure, verifyDirectSsh } from './direct-ssh-checks';

setInterfaceLanguage('zh');
function Fixture() {
  const [fonts] = useFonts(Ionicons.font);
  const [page, setPage] = useState('discover');
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof verifyDirectSsh>>>();
  const [status, setStatus] = useState('Checking direct SSH');
  const color = useThemeColor();
  useEffect(() => {
    let mounted = true;
    let dispose: (() => Promise<void>) | undefined;
    void verifyDirectSsh().then(value => {
      dispose = value.dispose;
      if (mounted) { setConnection(value); setStatus('Direct SSH checks passed'); }
      else void value.dispose();
    }).catch(async error => { const message = await reportDirectSshFailure(error); if (mounted) setStatus(message); });
    return () => { mounted = false; void dispose?.(); };
  }, []);
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: color('#ededed', 'canvas') }}>
    <ThemeStatusBar />
    {page !== 'ssh' && <><View style={{ flexDirection: 'row' }}>
      <Button title="Light" onPress={() => updateThemeMode('light')} />
      <Button title="Dark" onPress={() => updateThemeMode('dark')} />
    </View>
    <Text style={{ ...textMetrics(12, 18), color: color('#777', 'muted') }}>{status}</Text></>}
    {fonts && connection && (page === 'ssh'
      ? <SshPage client={connection.client} onBack={() => setPage('discover')} />
      : <DiscoveryPage onOpen={setPage} />)}
    <BottomNavigation activePage={page} onChange={setPage} />
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(Fixture);
