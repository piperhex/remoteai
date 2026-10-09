import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TurnRetryProvider } from '../../../shared/chat/TurnRetryContext';
import { failedTurnTarget, type TurnRetryTarget } from '../../../shared/chat/turnRetry';
import { Messages } from '../src/pages/codexGui/Messages';
import { conversation } from '../src/pages/codexGui/events';
import type { Thread } from '../src/pages/codexGui/types';
import { ChatMessages } from '../../web/src/chat/ChatMessages';
import styles from '../src/pages/codexGui/styles.module.less';
import '../../web/src/styles.css';
import '../../web/src/chat/chat.css';

const initial: Thread = { id: 'retry-thread', cwd: '', preview: '', updatedAt: 1, turns: [{
  id: 'failed', status: 'failed', error: { message: 'HTTP 502 Bad Gateway', additionalDetails: 'upstream timed out' },
  items: [{ id: 'question', type: 'userMessage', text: '请继续检查项目。' },
    { id: 'progress', type: 'agentMessage', text: '正在检查连接。', phase: 'commentary' }],
}] };
const ACK_DELAY_MS = 400;

function Harness() {
  const [thread, setThread] = useState(initial);
  const [attempts, setAttempts] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const remote = new URLSearchParams(location.search).has('remote');
  const retry = async (target: TurnRetryTarget) => {
    if (target.threadId !== thread.id || target.turnId !== thread.turns?.at(-1)?.id) return false;
    setAttempts(value => value + 1);
    await new Promise(resolve => setTimeout(resolve, ACK_DELAY_MS));
    if (attempts === 0) return false;
    setThread({ ...thread, turns: [...thread.turns!, { id: 'continued', status: 'inProgress', items: [
      { id: 'reply', type: 'agentMessage', text: '已继续检查项目。' },
    ] }] });
    return true;
  };
  return <TurnRetryProvider target={failedTurnTarget(thread.id, thread.turns)} disabled={unavailable} onRetry={retry}>
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav><label><input type="checkbox" checked={unavailable}
        onChange={event => setUnavailable(event.target.checked)} />暂不可用</label>
        <output aria-label="发送次数">{attempts}</output></nav>
      {remote ? <div className="chat-page" style={{ flex: 1, minHeight: 0 }}><div className="chat-conversation">
        <ChatMessages thread={thread} />
      </div></div> : <div className={`${styles.page} ${styles.collapsed}`} style={{ flex: 1, minHeight: 0 }}>
        <div className={styles.workspace}><Messages selected={thread.id} value={conversation(thread)} /></div>
      </div>}
      <footer style={{ padding: 16 }}><input aria-label="消息草稿" /></footer>
    </main>
  </TurnRetryProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
