import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheet } from '../src/components/BottomSheet';
import { ChatPhotoEditor } from '../src/chat/ChatPhotoEditor';
import { useThemeColor, useThemeMode } from '../src/theme/store';
import { setThemeMode } from '../src/theme/preference';
import { textMetrics } from '../src/theme/text';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { statusBarTestImage } from './modalStatusBarImage';

setInterfaceLanguage('zh');
void setThemeMode('light');
const REFRESH_MS = 250;

function ModalStatusBarFixture() {
  const theme = useThemeMode();
  const color = useThemeColor();
  const [screen, setScreen] = useState<'editor' | 'sheet' | null>(null);
  const [nested, setNested] = useState(false);
  const [photo, setPhoto] = useState(statusBarTestImage);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setRefresh(value => value + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  const button = (label: string, run: () => void) => <Pressable accessibilityRole="button"
    accessibilityLabel={label} onPress={run} style={{ padding: 20 }}>
    <Text style={{ ...textMetrics(18, 28), color: color('#10251d', 'ink') }}>{label}</Text>
  </Pressable>;
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: color('#f7faf7', 'canvas') }}>
    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    {button('切换主题', () => { void setThemeMode(theme === 'dark' ? 'light' : 'dark'); })}
    {photo && button('打开图片标注', () => setScreen('editor'))}
    {button('打开设置抽屉', () => setScreen('sheet'))}
    <Text style={{ ...textMetrics(14, 22), color: color('#10251d', 'ink') }}>{theme} · {refresh}</Text>
    {screen === 'editor' && <ChatPhotoEditor photo={{ dataUrl: photo }} save={setPhoto}
      close={() => setScreen(null)} />}
    <BottomSheet visible={screen === 'sheet'} title="设置" onClose={() => setScreen(null)}>
      <View style={{ minHeight: 350 }}>
        {button('切换主题', () => { void setThemeMode(theme === 'dark' ? 'light' : 'dark'); })}
        {button('打开下一层', () => setNested(true))}
        <TextInput accessibilityLabel="键盘避让验证" placeholder="键盘避让验证"
          style={{ color: color('#10251d', 'ink'), minHeight: 48, margin: 20, borderWidth: 1 }} />
      </View>
      <BottomSheet visible={nested} title="下一层" onClose={() => setNested(false)}>
        <View style={{ minHeight: 250 }} />
      </BottomSheet>
    </BottomSheet>
  </SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(ModalStatusBarFixture);
