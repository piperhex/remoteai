import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LoungePage } from '../src/lounge/LoungePage';
import { useNativeLounge } from '../src/lounge/useNativeLounge';
import type { AuthSession } from '../src/types';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { updateThemeMode } from '../src/theme/store';
import { loungeAvatarVersion } from '../../../shared/lounge/avatarCache';

const session: AuthSession = { baseUrl: 'http://127.0.0.1:1499', email: 'alice@example.test',
  accessToken: 'fixture', refreshToken: 'fixture' };
setInterfaceLanguage('zh');
updateThemeMode('light');

function Fixture() {
  const [fonts] = useFonts(Ionicons.font);
  const { controller, state } = useNativeLounge(session);
  useEffect(() => {
    if (state.status !== 'connected') return;
    void fetch(`${session.baseUrl}/snapshot`, { method: 'POST', body: JSON.stringify({
      self: loungeAvatarVersion(state.user?.avatar ?? ''),
      messages: state.messages.map(message => ({ id: message.id, sender: message.sender.id,
        avatar: loungeAvatarVersion(message.sender.avatar ?? '') })),
    }) });
  }, [state]);
  useEffect(() => {
    if (state.status === 'connected') void controller.send({ text: 'Native cached avatar', images: [] });
  }, [controller, state.status]);
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f8' }}>
    {fonts && <LoungePage controller={controller} onBack={() => {}} />}
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(Fixture);
