import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { ChatAsyncQuestions } from '../../../shared/remote-chat/views/ChatAsyncQuestions';
import { AsyncQuestions } from '../src/pages/codexGui/AsyncQuestions';
import type { Conversation, Item } from '../../../shared/conversation/types';
import type { Thread } from '../../../shared/remote-chat/views/types';
import 'antd/dist/reset.css';
import '../../../shared/remote-chat/views/chat.css';
import '../../../shared/remote-chat/views/composer.css';
import '../../../shared/remote-chat/views/messages.css';

const query = new URLSearchParams(location.search);
const mode = query.get('mode') ?? 'remote';
const dark = query.has('dark');
const title = '你提到的虚拟机在 Remote AI 中叫什么？当前在线电脑有 ZH2、Codex、DESKTOP-2HPUEHM。'
  + '提供对应名称后，我可以继续核对实际连接路径和网卡状态。';
const item: Item = { id: 'question', type: 'agentMessage', delivery: 'async', text: title,
  questions: [{ title, options: query.has('options') ? ['ZH2', 'Codex', 'DESKTOP-2HPUEHM'] : null }] };
const thread: Thread = { id: 'question-thread', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'inProgress', items: [item] }] };
const conversation: Conversation = { thread, activeTurn: 'turn', tokens: 0, error: '', turns: thread.turns! };
const algorithms = [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  ...(mode === 'web' ? [] : [theme.compactAlgorithm])];

function Harness() {
  const [complete, setComplete] = useState(false);
  const answer = async (_item: Item, answers: string[]) => {
    const response = await fetch('/question-answer', { method: 'POST', body: JSON.stringify(answers) });
    if (response.ok) setComplete(true);
    return response.ok;
  };
  return <ConfigProvider theme={{ algorithm: algorithms, token: { colorPrimary: '#14806f', borderRadius: 10 } }}>
    <ApplicationTypography><App><main style={{ maxWidth: 900, margin: '40px auto', padding: 24 }}>
      {!complete && (mode === 'local' ? <AsyncQuestions value={conversation} onAnswer={answer} />
        : <ChatAsyncQuestions thread={thread} scope="question-dialog" disabled={query.has('disabled')}
          error="" answer={answer} />)}
    </main></App></ApplicationTypography>
  </ConfigProvider>;
}

document.documentElement.style.cssText = dark
  ? '--app-border:#3a4240;--app-surface:#141414;--app-accent:#49baa3;--app-accentSoft:#193a31;'
    + '--app-muted:#a1aaa7;--panel:#141414;--ink:#ededed;--line:#3a4240;--gui-muted:#a1aaa7'
  : '--app-border:#dce8df;--app-surface:#fff;--app-accent:#14806f;--app-accentSoft:#e6f8f1;'
    + '--app-muted:#6f8177;--gui-muted:#6f8177';
document.body.style.background = dark ? '#171c1a' : '#f4f6f5';
document.body.style.fontFamily = "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif";
createRoot(document.getElementById('root')!).render(<Harness />);
