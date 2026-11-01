import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { setInterfaceLanguage } from "../../../shared/localization/interfaceLanguage";
import { createProjectBrowserClient } from '../../../shared/project-browser/protocol';
import { browserRequest, browserRoot, seedLargeText } from '../../desktop/e2e/project-browser-fixture';
import { ProjectBrowser } from '../src/chat/ProjectBrowser';
import { setFileAutoSave } from '../src/settings/filePreferences';
import { ChatFileReferencesProvider, useComposerFileReferences } from '../../../shared/chat/ChatFileReferences';
import type { ReplyQuote } from '../../desktop/src/pages/codexGui/replyQuotes';

setInterfaceLanguage('zh');
seedLargeText();
void setFileAutoSave(0);
const client = createProjectBrowserClient(browserRequest);

function QuoteReceiver() {
  const [quote, setQuote] = useState<ReplyQuote>();
  useComposerFileReferences({ scope: 'fixture', enabled: true, add: () => true,
    addQuote: value => { setQuote(value); return true; }, focus: () => {} });
  return quote ? <Text testID="file-quote">{quote.text}</Text> : null;
}

function Fixture() {
  const [open, setOpen] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  return <ChatFileReferencesProvider><SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
    <QuoteReceiver />
    <View style={{ padding: 24 }}>
      <Text>文件浏览测试</Text>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ padding: 16 }}>
        <Text>打开文件浏览</Text>
      </Pressable>
    </View>
    {open && <ProjectBrowser client={client} cwd={browserRoot} connected={foreground} active
      onClose={() => setOpen(false)} />}
  </SafeAreaView></SafeAreaProvider></ChatFileReferencesProvider>;
}
registerRootComponent(Fixture);
