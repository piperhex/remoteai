import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { DiscoveryPage } from '../src/discovery/DiscoveryPage';
import { BottomNavigation } from '../src/discovery/BottomNavigation';
import { LoungePage } from '../src/lounge/LoungePage';
import { useNativeLounge } from '../src/lounge/useNativeLounge';
import type { AuthSession } from '../src/types';
import { textMetrics } from '../src/theme/text';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { updateThemeMode, useThemeColor } from '../src/theme/store';
import { SettingsPage } from '../src/settings/SettingsPage';
import type { TotpManagerState } from '../src/totp/types';

const totpManager: TotpManagerState = { entries: [], initialized: true, syncing: false, cloudSyncEnabled: false,
  addEntry() {}, deleteEntry() {}, updateEntry() {}, setCloudSyncEnabled: async () => {},
  refreshCloud: async () => 'empty' };

const session: AuthSession = { baseUrl: 'http://127.0.0.1:1497', email: 'alice@example.test',
  accessToken: 'fixture', refreshToken: 'fixture' };
setInterfaceLanguage('zh');
updateThemeMode('dark');
function LoungeFixture() {
  const color = useThemeColor();
  const [fonts] = useFonts(Ionicons.font);
  const [page, setPage] = useState('discover');
  const [signedIn, setSignedIn] = useState(true);
  const lounge = useNativeLounge(signedIn ? session : null);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { setPage('discover'); return true; });
    return () => listener.remove();
  }, []);
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: color('#f5f7f8', 'canvas') }}>
    {fonts && signedIn && <>
      {page === 'lounge' ? <LoungePage controller={lounge.controller} onBack={() => setPage('discover')} />
        : page === 'settings' ? <SettingsPage session={session} profile={null} globalRefreshMinutes={30}
          onGlobalRefreshMinutesChange={async () => {}} onOpenAbout={() => {}} onOpenAdmin={() => {}}
          onLogout={() => setSignedIn(false)} totpManager={totpManager} loungeController={lounge.controller} />
        : <View style={{ flex: 1 }}>
        <DiscoveryPage loungeUnread={lounge.state.unread} onOpen={setPage} />
        <Pressable onPress={() => setInterfaceLanguage('en')}><Text style={textMetrics(14, 22)}>English</Text></Pressable>
        <Pressable onPress={() => updateThemeMode('light')}><Text style={textMetrics(14, 22)}>Light fixture</Text></Pressable>
        <Pressable onPress={() => setSignedIn(false)}><Text style={textMetrics(14, 22)}>Sign out fixture</Text></Pressable>
      </View>}
      {page !== 'lounge' && <BottomNavigation activePage={page} loungeUnread={lounge.state.unread} onChange={setPage} />}
    </>}
    {!signedIn && <Text style={textMetrics(16, 24)}>Signed out fixture</Text>}
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(LoungeFixture);
