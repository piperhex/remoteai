import { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { ConnectedChat } from '../../../shared/remote-chat/views/ConnectedChat';
import { GuiController } from '../src/pages/codexGui/controller';
import { Composer } from '../src/pages/codexGui/Composer';
import { guiApi } from '../../../shared/conversation/api';
import { demoResponse, demoState } from './demo-conversation';
import type { RpcRequest } from '../../../shared/remote-chat/protocol';
import type { GuiEvent } from '../../../shared/conversation/types';
import 'antd/dist/reset.css';
import '../src/styles.css';
import '../../../shared/remote-chat/views/chat.css';

const mode = new URLSearchParams(location.search).get('mode') ?? 'local';
document.body.style.minWidth = '0';
const local = new GuiController();
let localEvent: (event: GuiEvent) => void = () => {};
const remote = new ChatController(events => ({
  start: () => { events.mode('relay'); events.ready(); }, stop: () => {},
  request: async <T,>(method: string, body?: unknown) => demoResponse({ method, body } as RpcRequest, {
    send: async message => { if (message.kind === 'event') events.event(message.event); },
  }) as T,
}));
guiApi.connect = async () => [];
guiApi.subscribe = async callback => { localEvent = callback; return () => {}; };
guiApi.request = async <T,>(body: Parameters<typeof guiApi.request>[0]) =>
  demoResponse({ method: 'request', body } as RpcRequest, {
    send: async message => { if (message.kind === 'event') localEvent(message.event as GuiEvent); },
  }) as T;

function Fixture() {
  const state = useSyncExternalStore(local.subscribe, local.getSnapshot);
  const chat = useSyncExternalStore(remote.subscribe, remote.snapshot);
  useEffect(() => {
    if (mode === 'local') { void local.connect(); return () => local.dispose(); }
    remote.start(); return () => remote.stop();
  }, []);
  const choose = (target: string) => {
    if (target === 'existing') {
      if (mode === 'local') void local.select('demo-chat');
      else void remote.select(demoState().threads[0]);
    } else {
      const cwd = target === 'empty' ? '' : `F:/projects/${target}`;
      if (mode === 'local') { local.newConversation(); local.setProject(cwd); }
      else remote.back(cwd ? { cwd, label: target } : null);
    }
  };
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: mode === 'local' || mode === 'remote'
    ? [theme.defaultAlgorithm, theme.compactAlgorithm] : theme.defaultAlgorithm }}><App>
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap' }}>
        {['empty', 'project-a', 'project-b', 'existing'].map(target =>
          <button key={target} onClick={() => choose(target)}>{target}</button>)}
      </nav>
      {mode === 'local' ? <div style={{ marginTop: 'auto', padding: 20 }}>
        <Composer active state={state} controller={local} />
      </div> : <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <ConnectedChat chat={{ state: chat, controller: remote, foreground: true }}
          devices={[]} active scope="draft-fixture" email="fixture@example.test" chooseDevice={() => {}}
          cliVersion="0.162.1" scrollableComposer={mode === 'remote'} />
      </div>}
    </main>
  </App></ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
