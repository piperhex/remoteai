import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { Messages } from '../src/pages/codexGui/Messages';
import { RemoteUserMessage } from '../src/pages/codexGui/remote/RemoteUserMessage';
import { ChatMessages } from '../../../shared/remote-chat/views/ChatMessages';
import { conversation } from '../../../shared/conversation/events';
import { initialChatState, type Thread } from '../../../shared/remote-chat/client/types';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import type { MessageEdit, MessageTarget } from '../../../shared/conversation/editMessage';
import styles from '../../../shared/conversation/styles.module.less';
import '../../../shared/remote-chat/views/chat.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const remote = new URLSearchParams(location.search).has('remote');
const dark = new URLSearchParams(location.search).has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
const initial: Thread = { id: 'thread', cwd: '', preview: '', updatedAt: 1, turns: [
  { id: 'first', status: 'completed', items: [{ id: 'old', type: 'userMessage',
    content: [{ type: 'text', text: '请保留这条消息。' }] },
  { id: 'old-reply', type: 'agentMessage', text: '之前的回复也会保留。' }] },
  { id: 'last', status: 'completed', items: [{ id: 'user', type: 'userMessage',
    content: [{ type: 'text', text: '请修改最后这条消息。' }] },
  { id: 'reply', type: 'agentMessage', text: '这条回复会随最后的消息一同删除。' }] },
] };

function Harness() {
  const [thread, setThread] = useState(initial);
  const state = { ...initialChatState(), ready: true, selected: thread };
  const change = async (target: MessageTarget | MessageEdit) => {
    setThread(previous => ({ ...previous, turns: previous.turns!.flatMap(turn => {
      if (turn.id !== target.turnId) return [turn];
      return 'text' in target ? [{ ...turn, items: [{ ...turn.items[0],
        content: [{ type: 'text', text: target.text }] }] }] : [];
    }) }));
    return true;
  };
  const controller = useMemo(() => new ChatController(() => ({
    request: async () => { throw new Error('unexpected network call'); }, start: () => {}, stop: () => {},
  })), []);
  controller.messageEditor.submit = change;
  controller.messageEditor.remove = change;
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <main className={`${styles.page} ${styles.collapsed} ${remote ? 'chat-page gui-remote-workspace' : ''}`}>
      {remote ? <div className="chat-conversation"><ChatMessages thread={thread}
        renderUserMessage={props => <RemoteUserMessage {...props} state={state} controller={controller} active />} /></div>
        : <div className={styles.workspace}><Messages selected={thread.id} value={conversation(thread)}
          onEdit={change} onDelete={change} /></div>}
    </main>
  </ConfigProvider>;
}

const css = document.createElement('style');
css.textContent = '*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif}'
  + 'html,body,#root{height:100%}:root{--ink:#233329;--panel:#fff;--line:#dfe6e1;'
  + '--muted:#66796d;--green:#168348;--green-dark:#126a3b;--green-soft:#e7f4ec}'
  + ':root[data-theme=dark]{color-scheme:dark;--ink:#e6e8eb;--muted:#9298a1;--line:#2b2f33;--panel:#17191c}';
document.head.append(css);
createRoot(document.getElementById('root')!).render(<Harness />);
