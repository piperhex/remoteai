import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { emptyGrouping, type Grouping, type GroupMutation } from '../../../shared/chat/groups/model';
import { mutateGrouping } from '../../../shared/chat/groups/mutations';
import { ChatThreads } from '../src/chat/ChatThreads';
import type { ChatController as NativeController } from '../src/chat/controller';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { textMetrics } from '../src/theme/text';

setInterfaceLanguage('zh');

type FailureMode = 'none' | 'legacy' | 'delayed';
function createController(failure: FailureMode) {
  const threads = [{ id: 'one', name: '项目里的对话', cwd: '/project', preview: '', updatedAt: 2 },
    { id: 'two', name: '其他项目的对话', cwd: '/other', preview: '', updatedAt: 1 }];
  let grouping: Grouping = { ...emptyGrouping(), groups: [
    { id: 'work', name: '工作', parentId: null }, { id: 'client', name: '客户端', parentId: 'work' },
    { id: 'research', name: '研究', parentId: null },
  ] };
  let revision = 0;
  const sidebar = () => ({ revision: ++revision, grouping, pins: [], readState: {},
    threads: Object.fromEntries(threads.map(thread => [thread.id, { cwd: thread.cwd,
      projectName: thread.cwd === '/project' ? '项目文件夹中文显示测试' : '其他项目', title: thread.name, running: false }])) });
  return new ChatController(events => ({
    start() { events.mode('relay'); events.ready(); }, stop() {},
    async request<T>(method: string, body?: unknown): Promise<T> {
      if (method === 'connect') return [] as T;
      const input = body as { operation: string; action?: string; mutation: GroupMutation };
      if (input.operation === 'list') return { data: threads, nextCursor: null, sidebar: sidebar() } as T;
      if (input.operation === 'guiGroups') {
        if (failure !== 'none') {
          if (failure === 'delayed') await new Promise(resolve => setTimeout(resolve, 6000));
          throw new Error('当前手机端暂不支持此操作。');
        }
        if (input.action === 'members') return [
          { kind: 'project', id: '/project', title: '项目文件夹中文显示测试', cwd: '/project' },
          { kind: 'project', id: '/other', title: '其他项目', cwd: '/other' },
          ...threads.map(thread => ({ kind: 'thread', id: thread.id, title: thread.name, cwd: thread.cwd })),
        ] as T;
        grouping = mutateGrouping(grouping, input.mutation); return sidebar() as T;
      }
      return { data: [], nextCursor: null } as T;
    },
  }));
}

function Fixture() {
  const [failure, setFailure] = useState<FailureMode>('none');
  const controller = useMemo(() => createController(failure), [failure]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [fontsReady] = useFonts(Feather.font);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
    <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16 }}>
      {(['none', 'legacy', 'delayed'] as const).map(mode => <Pressable key={mode}
        accessibilityRole="button" accessibilityLabel={`fixture-${mode}`} onPress={() => setFailure(mode)}
        style={{ padding: 8 }}><Text style={textMetrics(14, 22)}>{mode}</Text></Pressable>)}
    </View>
    {fontsReady && <ChatThreads state={state} controller={controller as NativeController}
      newChat={() => {}} select={() => {}} openSearch={() => {}} profileMenu={null} />}
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(Fixture);
