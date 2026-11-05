import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ActivityRow } from '../src/pages/codexGui/ActivityRow';
import { ChatActivity } from '../../../shared/remote-chat/views/ChatActivity';
import { ToolDetailsContext, localToolDetails } from '../../../shared/chat/DeferredToolDetails';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import type { Item } from '../../../shared/conversation/types';
import { setThemeMode } from '../../web/src/theme/preference';
import guiStyles from '../../../shared/conversation/styles.module.less';
import '../src/pages/codexGui/remote/remoteGui.less';
import 'antd/dist/reset.css';
import '../src/styles.css';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import '../../../shared/remote-chat/views/messages.css';
import '../../../shared/remote-chat/views/desktopMessages.css';

const query = new URLSearchParams(location.search);
const mode = query.get('mode') ?? 'local';
const dark = query.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
setThemeMode(dark ? 'dark' : 'light');
const controller = new ChatController(() => ({ start() {}, stop() {},
  request: async <T,>(_method: string, body?: unknown) => {
    const response = await fetch('deferred-tool-details-response', { method: 'POST', body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Fixture unavailable');
    return await response.json() as T;
  },
}));
const initial: Item = { id: 'command', type: 'commandExecution', status: 'inProgress', commandPreview: 'npm test',
  detailsRef: { threadId: 'chat', turnId: 'turn', itemId: 'command' } };

function Harness() {
  const [item, setItem] = useState(initial);
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    const update = (event: Event) => setItem({ ...initial, ...(event as CustomEvent<Partial<Item>>).detail });
    window.addEventListener('deferred-tool-details-update', update);
    const timer = setInterval(() => setBeats(value => value + 1), 50);
    return () => { clearInterval(timer); window.removeEventListener('deferred-tool-details-update', update); };
  }, []);
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  return <ConfigProvider theme={{ algorithm: mode === 'web' ? algorithm : [algorithm, theme.compactAlgorithm] }}>
    <ApplicationTypography><ToolDetailsContext.Provider value={{
      load: mode === 'local' ? localToolDetails : controller.toolDetails, active: true,
    }}>
      <main className={`chat-page ${mode === 'web' ? '' : guiStyles.page}
        ${mode === 'remote' ? 'gui-remote-workspace' : ''}`}
        style={{ display: 'block', height: '100vh', width: '100%', padding: 32 }}>
        <section style={{ maxWidth: 920, margin: '0 auto' }}>
          <h2>Codex GUI</h2><p>检查项目测试结果</p>
          {mode === 'local' ? <ActivityRow item={item} text="" />
            : <ChatActivity item={item} running={item.status === 'inProgress'} inline onOpen={() => {}} />}
          <p style={{ marginTop: 24 }}>测试正在执行，完成后汇总结果。</p>
        </section><output hidden aria-label="heartbeat">{beats}</output>
      </main>
    </ToolDetailsContext.Provider></ApplicationTypography>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
