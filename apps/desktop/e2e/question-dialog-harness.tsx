import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { mockIPC } from '@tauri-apps/api/mocks';
import { createRemoteDictationClient } from '../../../shared/remote-chat/dictation';
import { setLanguage } from '../../../shared/localization/browserLanguage';
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
if (query.has('multi')) item.questions!.push({ title: '底部纠错提示的字号和位置是否需要调整？',
  options: ['调整提示位置和字号（推荐）', '保留当前样式'] });
const other: Item = { ...item, id: 'other', questions: [{ title: '是否继续核对其他页面？',
  options: ['继续检查', '暂时结束'] }] };
const thread: Thread = { id: 'question-thread', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'inProgress', items: query.has('multiple') ? [item, other] : [item] }] };
const conversation: Conversation = { thread, activeTurn: 'turn', tokens: 0, error: '', turns: thread.turns! };
const algorithms = [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  ...(mode === 'web' ? [] : [theme.compactAlgorithm])];
async function dictationRequest<T>(body: unknown): Promise<T> {
  const response = await fetch('/question-dictation', { method: 'POST', body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
const dictation = createRemoteDictationClient({ request: dictationRequest,
  subscribeAccountChange: changed => {
    window.addEventListener('question-account-change', changed);
    return () => window.removeEventListener('question-account-change', changed);
  } });
if (mode === 'local') mockIPC((command, payload) => {
  if (!command.startsWith('codex_gui_dictation_')) return null;
  const args = payload as { request?: object; sessionId?: string };
  return dictationRequest({ action: command.replace('codex_gui_dictation_', ''), ...args, ...args.request });
});

function Harness() {
  const [complete, setComplete] = useState<string[]>([]);
  const [threadId, setThreadId] = useState(thread.id);
  const [active, setActive] = useState(true);
  const [disabled, setDisabled] = useState(query.has('disabled'));
  const answer = async (_item: Item, answers: string[]) => {
    const response = await fetch('/question-answer', { method: 'POST', body: JSON.stringify(answers) });
    if (response.ok) setComplete(previous => [...previous, _item.id]);
    return response.ok;
  };
  return <ConfigProvider theme={{ algorithm: algorithms, token: { colorPrimary: '#14806f', borderRadius: 10 } }}>
    <ApplicationTypography><App><main style={{ maxWidth: 900, margin: '40px auto', padding: 24 }}>
      <div style={{ marginBottom: 30, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setThreadId(value => value === thread.id ? 'other-thread' : thread.id)}>切换会话</button>
        <button onClick={() => setActive(value => !value)}>切换可见状态</button>
        <button onClick={() => setDisabled(value => !value)}>切换连接</button>
        {(['zh', 'en', 'ja', 'ru'] as const).map(language =>
          <button key={language} onClick={() => setLanguage(language)}>{language}</button>)}
      </div>
      {(() => {
        const turns = thread.turns!.map(turn => ({ ...turn,
          items: turn.items.filter(entry => !complete.includes(entry.id)) }));
        const currentThread = { ...thread, id: threadId, turns };
        return mode === 'local' ? <AsyncQuestions value={{ ...conversation, thread: currentThread, turns }}
          active={active} disabled={disabled} onAnswer={answer} />
          : <ChatAsyncQuestions thread={currentThread} scope="question-dialog" disabled={disabled}
            paginated={mode === 'remote' || undefined} dictation={dictation} active={active}
            error="" answer={answer} />;
      })()}
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
