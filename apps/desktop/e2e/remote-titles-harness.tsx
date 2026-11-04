import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { threadPresentation } from '../../../shared/remote-chat/sidebar';
import { SIDEBAR_EVENT } from '../../../shared/remote-chat/sidebar';
import { QUEUE_EVENT } from '../../../shared/remote-chat/queue';
import { COMPOSER_EVENT } from '../../../shared/remote-chat/composer';
import { ChatOperations } from '../src/remoteChat/operations';
import { remoteQueue } from '../src/remoteChat/queue';
import { guiApi } from '../../../shared/conversation/api';
import { guiSidebar } from '../src/pages/codexGui/sidebarBridge';
import { guiComposer } from '../src/pages/codexGui/composerBridge';
import { retainGuiSession } from '../src/pages/codexGui/session';
import { useUsageStatus } from '../src/pages/codexGui/useUsageStatus';

function remoteController() {
  const operations = new ChatOperations();
  let serial = 0;
  let cleanup = () => {};
  return new ChatController((events) => ({
    start() {
      const release = retainGuiSession();
      const sidebar = guiSidebar.subscribe((params) => events.event({ method: SIDEBAR_EVENT, params }));
      const queue = remoteQueue.subscribe((params) => events.event({ method: QUEUE_EVENT, params }));
      const composer = guiComposer.subscribe((params) => events.event({ method: COMPOSER_EVENT, params }));
      const subscribed = guiApi.subscribe((event) => {
        guiSidebar.receive(event);
        events.event(operations.prepareEvent(event));
      });
      cleanup = () => {
        void subscribed.then((stop) => stop()); sidebar(); queue(); composer(); release(); operations.release();
      };
      void subscribed.then(() => { events.mode('relay'); events.ready(); });
    },
    stop() { cleanup(); },
    async request<T>(method: 'connect' | 'request' | 'respond', body?: unknown): Promise<T> {
      const response = await operations.execute({ kind: 'request', method, id: `remote-${++serial}`, body });
      if (response.error) throw new Error(response.error);
      return response.data as T;
    },
  }));
}

const controller = remoteController();
function Harness() {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [text, setText] = useState('');
  const [beats, setBeats] = useState(0);
  useUsageStatus(true);
  useEffect(() => { controller.start(); return () => controller.stop(); }, []);
  useEffect(() => {
    const timer = setInterval(() => setBeats((count) => count + 1), 50);
    return () => clearInterval(timer);
  }, []);
  return <main>
    <output aria-label="刷新次数">{beats}</output>
    <ul>{state.threads.map((thread) => <li key={thread.id}>
      <button onClick={() => void controller.select(thread)}>{threadPresentation(thread, state.sidebar).title}</button>
    </li>)}</ul>
    <p role="status" aria-label="回复状态">
      {state.selected?.turns?.some((turn) => turn.status === 'inProgress') ? '正在回复' : '可以发送'}</p>
    <textarea aria-label="聊天消息" value={text} onChange={(event) => setText(event.target.value)} />
    <button disabled={!state.ready || state.sending || state.settingsBusy} onClick={async () => {
      if (await controller.send({ text, access: 'workspace-write' })) setText('');
    }}>发送</button>
    {state.error && <p role="alert">{state.error}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
