import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useState, type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ChatComposer } from '../src/chat/ChatComposer';
import { useStyles } from '../src/chat/styles';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { createRemoteDictationClient } from '../../../shared/remote-chat/dictation';
import { testModels } from '../../desktop/src/pages/codexGui/testModels';
import { updateThemeMode } from '../src/theme/store';

setInterfaceLanguage('zh');
const noop = () => {};
const base: Omit<ComponentProps<typeof ChatComposer>, 'send'> = {
  models: testModels, selection: { model: 'gpt-test', effort: 'high', access: 'workspace-write' },
  threadId: 'dictation-test', active: true, ready: true, sending: false, running: false,
  settingsBusy: false, settingsError: '', compacting: false, compactReason: null, cwd: '/project',
  updateSettings: async () => {}, refreshModels: async () => {}, interrupt: async () => {}, compact: async () => true,
  contextSettings: { read: async () => ({ capacity: null }), write: async (_id, value) => value },
  catalog: { skills: [], loaded: true, loading: false, error: '', refresh: noop },
  loadFiles: async () => ({ directory: '/project', parent: null, entries: [], truncated: false }),
  loadCatalog: async () => ({ data: [], plugins: [] }), loadConversations: async () => ({ data: [], nextCursor: null }),
  usageActive: true,
  readUsage: async () => ({ totalTokens: 0, estimatedCostUsd: 0, primaryRemainingPercent: null,
    primaryRemainingAggregated: false, providerEstimatedCost: null }),
  readConversationMetrics: async () => ({ totalOutputTokens: 0, totalOutputTimeMs: 0, outputRequestCount: 0 }),
  connection: { deviceName: '测试电脑', chooseDevice: noop, client: {
    read: async () => ({ running: true, choices: [], selection: { kind: 'none' } }),
    select: async selection => selection, subscribe: () => noop,
  } },
};
const dictation = createRemoteDictationClient({
  subscribeAccountChange: () => noop,
  request: async <T,>(body: unknown): Promise<T> => {
    const response = await fetch('http://127.0.0.1:17941/dictation', { method: 'POST', body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  },
});

function DictationFixture() {
  const styles = useStyles();
  const [running, setRunning] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [threadId, setThreadId] = useState('dictation-test');
  const [dark, setDark] = useState(false);
  const [sent, setSent] = useState('');
  return <SafeAreaProvider><SafeAreaView style={[styles.page, { justifyContent: 'space-between' }]}>
    <View style={{ padding: 16, gap: 8 }}>
      <Text style={styles.title}>新聊天</Text>
      <Text accessibilityLabel="已发送">{sent}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="切换运行" onPress={() => setRunning(value => !value)}>
        <Text>切换运行</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="切换中断"
        onPress={() => setInterrupted(value => !value)}><Text>切换中断</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="切换对话"
        onPress={() => setThreadId(value => value === 'dictation-test' ? 'other' : 'dictation-test')}>
        <Text>切换对话</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="切换主题"
        onPress={() => { setDark(!dark); updateThemeMode(dark ? 'light' : 'dark'); }}><Text>切换主题</Text></Pressable>
    </View>
    <ChatComposer {...base} threadId={threadId} dictation={dictation} running={running} interrupted={interrupted}
      interrupt={async () => { setRunning(false); setInterrupted(true); }}
      send={async input => { setSent(input.text); return true; }} />
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(DictationFixture);
