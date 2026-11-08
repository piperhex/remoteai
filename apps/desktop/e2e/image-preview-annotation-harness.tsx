import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ConnectedChat } from '../../../shared/remote-chat/views/ConnectedChat';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { testModels } from '../../../shared/conversation/testing/models';
import type { Thread } from '../../../shared/conversation/types';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { setThemeMode } from '../../web/src/theme/preference';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';
import { ChatImage } from '../../../shared/remote-chat/views/ChatImage';
import 'antd/dist/reset.css';
import '../../web/src/styles.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const params = new URLSearchParams(location.search);
const desktop = params.get('mode') === 'remote';
const dark = params.has('dark');
setInterfaceLanguage('zh');
setThemeMode(dark ? 'dark' : 'light');
const source = document.createElement('canvas');
source.width = 1000; source.height = 600;
const context = source.getContext('2d')!;
context.fillStyle = '#e7f0ed'; context.fillRect(0, 0, 1000, 600);
context.fillStyle = '#28837f'; context.fillRect(200, 180, 600, 240);
const thread: Thread = { id: 'annotation', name: '图片标注', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'completed', items: [
    { id: 'answer', type: 'agentMessage', text: `![界面截图](${source.toDataURL()})` },
  ] }] };
const sent: unknown[] = [];
const controller = new ChatController(events => ({
  start: () => { events.mode('relay'); events.ready(); }, stop: () => {},
  request: async <T,>(method: string, input?: unknown): Promise<T> => {
    const body = input as { operation?: string } | undefined;
    let result: unknown = { data: [], nextCursor: null };
    if (method === 'connect') result = [];
    if (body?.operation === 'models') result = { data: testModels, nextCursor: null };
    if (body?.operation === 'read' || body?.operation === 'resume') result = { thread };
    if (body?.operation === 'list') result = { data: [thread], nextCursor: null };
    if (body?.operation === 'queueRead') result = { revision: 0, threads: {} };
    if (body?.operation === 'send' || body?.operation === 'queueEnqueue') {
      sent.push(input);
      result = { revision: 1, threads: {}, enqueuedId: 'sent' };
    }
    if (body?.operation === 'syncHistory') throw new Error('当前手机端暂不支持此操作。');
    return result as T;
  },
}));
const device = { deviceId: 'annotation-pc', name: '测试电脑', platform: 'Windows', online: true };
const unavailable = async (): Promise<never> => { throw new Error('Unexpected file operation'); };
const environment: FileEnvironment = {
  remote: true, actions: { applications: unavailable, perform: unavailable },
  previews: { open: unavailable, close: unavailable }, resolveWebsite: unavailable,
  image: props => <ChatImage source={props.src} description={props.alt} />,
};

function Harness() {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const algorithm = [dark ? theme.darkAlgorithm : theme.defaultAlgorithm];
  if (desktop) algorithm.push(theme.compactAlgorithm);
  const chat = <ConnectedChat chat={{ state, controller, foreground: true }} device={device} devices={[device]}
    active scope="annotation-test" email="test@example.test" chooseDevice={() => {}} />;
  return <ConfigProvider theme={{ algorithm, token: { colorPrimary: '#28837f' } }}>
    <ApplicationTypography><main className={desktop ? 'chat-page gui-remote-workspace' : ''}
      style={{ height: '100dvh' }}>
      <FileEnvironmentContext.Provider value={desktop ? environment : null}>{chat}</FileEnvironmentContext.Provider>
    </main></ApplicationTypography>
  </ConfigProvider>;
}

Object.assign(window, { imageAnnotationFixture: { source: source.toDataURL(), sent } });
controller.start();
await controller.select(thread);
createRoot(document.getElementById('root')!).render(<Harness />);
