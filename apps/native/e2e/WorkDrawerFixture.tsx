import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ChatProcessSummary } from '../src/chat/ChatProcessSummary';
import { ChatWorkDrawer } from '../src/chat/ChatWorkDrawer';
import { ChatQuotesProvider } from '../src/chat/ChatQuotes';
import { updateThemeMode, useThemeMode } from '../src/theme/store';
import { textMetrics } from '../src/theme/text';
import type { WorkEntry } from '../src/chat/turnPresentation';
import type { Item } from '../src/chat/types';

const items: Item[] = [
  { id: 'first', type: 'commandExecution', status: 'completed', command: 'git status --short',
    cwd: 'F:/projects/codex-switch', aggregatedOutput: 'FIRST_OUTPUT\n工作区检查完成', exitCode: 0 },
  { id: 'live', type: 'commandExecution', status: 'inProgress', command: 'npm run check',
    cwd: 'F:/projects/codex-switch' },
  { id: 'tool', type: 'dynamicToolCall', status: 'failed', tool: 'review.check',
    result: { content: [{ type: 'text', text: 'TOOL_OUTPUT\n请检查命令输出。' }] } },
  { id: 'long', type: 'commandExecution', status: 'completed',
    command: 'Get-Content shared/chat/activityTimeline.ts; Get-Content apps/native/src/chat/ChatWorkDrawer.tsx',
    aggregatedOutput: Array.from({ length: 100 }, (_, i) => `LINE_${i} 检查记录`).join('\n'), exitCode: 0 },
  { id: 'last', type: 'commandExecution', status: 'completed', command: 'git diff --stat',
    aggregatedOutput: 'LAST_OUTPUT', exitCode: 0 },
];

function WorkDrawerFixture() {
  const [fonts] = useFonts({ ...Ionicons.font, ...Feather.font });
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const theme = useThemeMode();
  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), 2000);
    return () => clearInterval(timer);
  }, []);
  const liveItems = items.map(item => item.id === 'live'
    ? { ...item, aggregatedOutput: `LIVE_OUTPUT_${tick}\n正在检查，请稍候` } : item);
  const entry: WorkEntry = { id: 'work', kind: 'work', inline: false, items: liveItems,
    turn: { id: 'turn', status: 'inProgress', items: liveItems } };
  if (!fonts) return null;
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1,
    backgroundColor: theme === 'dark' ? '#121513' : '#fff' }}>
    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    <View style={{ padding: 20, gap: 20 }}>
      <ChatProcessSummary entry={entry} onOpen={() => setOpen(true)} onInline={() => {}} />
      <Pressable accessibilityRole="button" accessibilityLabel="Toggle theme"
        onPress={() => updateThemeMode(theme === 'dark' ? 'light' : 'dark')}>
        <Text style={{ ...textMetrics(16, 24), color: theme === 'dark' ? '#fff' : '#17211b' }}>Toggle theme</Text>
      </Pressable>
    </View>
    <ChatQuotesProvider scope="work-drawer" active enabled>
      {open && <ChatWorkDrawer entry={entry} onClose={() => setOpen(false)} />}
    </ChatQuotesProvider>
  </SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(WorkDrawerFixture);
