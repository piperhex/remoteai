// Isolated Android entry point: uses real chat rendering without an account, network or model.
import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { ChatMessages } from '../src/chat/ChatMessages';
import { ChatProcessing } from '../src/chat/ChatProcessing';
import type { Item, Thread } from '../src/chat/types';

const STREAM_STEPS = 160;
const STREAM_INTERVAL_MS = 100;
const HISTORY_DELAY_MS = 500;
const LINE = '正在检查富文本、代码高亮、工具详情、目录分组和文件预览，继续验证实时输出时的聊天位置。';
const DIFF = Array.from({ length: 55 }, (_, index) => [
  `diff --git a/src/file-${index}.ts b/src/file-${index}.ts`,
  `--- a/src/file-${index}.ts`, `+++ b/src/file-${index}.ts`, '@@ -1 +1 @@', '-before', '+after',
].join('\n')).join('\n');
type Mode = 'long' | 'short' | 'plain' | 'progress';

function history(count: number, prefix: string): Item[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`,
    type: 'commandExecution', status: 'completed', command: `echo ${prefix} ${index}` }));
}

function App() {
  const [fonts] = useFonts(Ionicons.font);
  const [mode, setMode] = useState<Mode>('long');
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [older, setOlder] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setStep((value) => Math.min(STREAM_STEPS, value + 1)), STREAM_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => { if (step === STREAM_STEPS) setRunning(false); }, [step]);
  const items: Item[] = mode === 'progress'
    ? Array.from({ length: 50 }, (_, index) => ({ id: `history-${index}`, type: 'userMessage',
      text: `历史消息 ${index}` }))
    : [...history(older ? 25 : 0, 'older'), ...history(mode === 'short' ? 1 : 90, 'anchor')];
  if (step) items.push({ id: 'reply', type: 'agentMessage', phase: 'commentary',
    text: LINE.repeat(12).slice(0, step * 3) });
  const thread: Thread = { id: 'scroll-fixture', cwd: '', preview: '', updatedAt: 1,
    turns: [{ id: 'turn', status: 'inProgress', items, ...(mode === 'long' ? { diff: DIFF } : {}) }] };
  const loadOlder = async () => {
    setLoadingMore(true);
    await new Promise((resolve) => setTimeout(resolve, HISTORY_DELAY_MS));
    setOlder(true);
    setLoadingMore(false);
  };
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
    <View style={{ flexDirection: 'row', padding: 14, gap: 12 }}>
      {(['long', 'short', 'plain', 'progress'] as const).map((value) => <Pressable key={value}
        accessibilityRole="button" onPress={() => {
          setMode(value); setRunning(false); setStep(0); setOlder(false);
        }}><Text>{value}</Text></Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel="Start stream"
        onPress={() => { setStep(0); setRunning(true); }}><Text>Start {step}</Text></Pressable>
    </View>
    {fonts && <ChatMessages key={mode} thread={thread} hasMore={mode === 'short' && !older}
      loadOlder={loadOlder} loadingMore={loadingMore}
      processing={<ChatProcessing turn={thread.turns![0]} active />} />}
    <TextInput accessibilityLabel="Keyboard test" placeholder="Keyboard test"
      style={{ padding: 16, backgroundColor: 'white' }} />
  </SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(App);
