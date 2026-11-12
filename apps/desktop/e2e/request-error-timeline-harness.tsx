import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Messages } from '../src/pages/codexGui/Messages';
import { ChatMessages } from '../../../shared/remote-chat/views/ChatMessages';
import { conversation, reduceConversation } from '../../../shared/conversation/events';
import { updateThread } from '../../../shared/remote-chat/client/events';
import { MODEL_CAPACITY_MESSAGE } from '../../../shared/conversation/requestError';
import type { GuiEvent, Thread } from '../../../shared/conversation/types';
import styles from '../../../shared/conversation/styles.module.less';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const remote = new URLSearchParams(location.search).has('remote');
const source: Thread = { id: 'timeline', cwd: '', preview: '', updatedAt: 1, turns: [{
  id: 'turn', status: 'inProgress', items: [
    { id: 'question', type: 'userMessage', text: '请检查项目中的修改。' },
    { id: 'before', type: 'agentMessage', phase: 'commentary', text: '正在检查修改，这是出错前的处理过程。' },
    { id: 'command', type: 'commandExecution', command: 'git diff --stat', status: 'completed', exitCode: 0 },
    { id: 'file', type: 'fileChange', status: 'completed', changes: [
      { path: 'src/example.ts', kind: { type: 'update' }, diff: '-old\n+new' },
    ] },
  ], plan: [{ step: '检查项目修改', status: 'inProgress' }],
}] };
const failure: GuiEvent = { method: 'error', params: { threadId: source.id, turnId: 'turn', willRetry: true,
  error: { message: MODEL_CAPACITY_MESSAGE } } };
const placeholder: GuiEvent = { method: 'item/started', params: { threadId: source.id, turnId: 'turn',
  item: { id: 'reasoning', type: 'reasoning', summary: [] } } };
const apply = (thread: Thread, event: GuiEvent): Thread => remote ? updateThread(thread, event)
  : { ...thread, turns: reduceConversation(conversation(thread), event).turns };

function Harness() {
  const [thread, setThread] = useState(() => apply(apply(source, failure), placeholder));
  const resume = () => setThread(current => apply(current, { method: 'item/completed', params: {
    threadId: source.id, turnId: 'turn', item: { id: 'after', type: 'agentMessage', phase: 'commentary',
      text: '连接已恢复，正在继续检查。' },
  } }));
  const stop = () => setThread(current => apply(current, { method: 'turn/completed', params: {
    threadId: source.id, turn: { id: 'turn', status: 'failed', items: [], error: failure.params.error },
  } }));
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <nav><button onClick={resume}>恢复连接</button><button onClick={stop}>重试失败</button></nav>
    {remote ? <main className={`chat-page ${styles.page} gui-remote-workspace`} style={{ flex: 1, minHeight: 0 }}>
      <div className="chat-conversation"><ChatMessages thread={thread}
        processing={<p data-testid="processing">等待响应…</p>} footer={<input aria-label="消息" />} /></div>
    </main> : <main className={`${styles.page} ${styles.collapsed}`} style={{ flex: 1, minHeight: 0 }}>
      <div className={styles.workspace}><Messages selected={source.id} value={conversation(thread)}
        canUndoChanges={false} footer={<input aria-label="消息" />} /></div>
    </main>}
  </div>;
}

const css = document.createElement('style');
css.textContent = '*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif}'
  + ':root{--ink:#233329;--panel:#fff;--line:#dfe6e1;--muted:#66796d;--green:#168348}';
document.head.append(css);
createRoot(document.getElementById('root')!).render(<Harness />);
