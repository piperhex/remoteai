import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { RichText } from '../../../shared/conversation/RichText';
import { ChatMarkdown } from '../../../shared/remote-chat/views/ChatMarkdown';
import { applyThemeMode } from '../src/utils/themeMode';
import { setThemeMode } from '../../web/src/theme/preference';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import styles from '../../../shared/conversation/styles.module.less';
import { mermaidRenderStats } from '../../../shared/chat/mermaidRenderer';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';

type FixtureUpdate = { source?: string; visible?: boolean; duplicate?: boolean; session?: string };
declare global {
  interface Window {
    mermaidFixture: { update: (value: FixtureUpdate) => void; stats: typeof mermaidRenderStats };
  }
}

const entry = new URLSearchParams(location.search).get('entry') ?? 'local';
if (entry.startsWith('web')) {
  await import('../../web/src/styles.css');
  await import('../../../shared/remote-chat/views/messages.css');
} else {
  await import('../src/styles.css');
  if (entry === 'remote') await import('../src/pages/codexGui/remote/remoteGui.less');
}
setInterfaceLanguage('zh');
const flow = 'flowchart LR\n A[提交问题] --> B{需要工具？}\n B -->|是| C[执行工具]\n B -->|否| D[生成答复]\n C --> D';
const sequence = 'sequenceDiagram\n participant U as 用户\n participant A as 助手\n U->>A: 发送消息\n A-->>U: 展示结果';
const markdown = (source: string) => '```mermaid\n' + source + '\n```';
const remoteEnvironment: FileEnvironment = {
  remote: true, image: () => null, resolveWebsite: async url => url,
  previews: { open: async () => null, close: async () => {} },
  actions: { applications: async () => [], perform: async () => { throw new Error('No files in Mermaid fixture'); } },
};

function Harness() {
  const [dark, setDark] = useState(false);
  const [source, setSource] = useState(flow);
  const [visible, setVisible] = useState(true);
  const [multiple, setMultiple] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [session, setSession] = useState('initial');
  const text = markdown(source) + (multiple ? '\n\n' + markdown(sequence) : '')
    + (duplicate ? '\n\n' + markdown(source) : '');
  useEffect(() => {
    window.mermaidFixture = { stats: mermaidRenderStats, update: value => flushSync(() => {
      if (value.source !== undefined) setSource(value.source);
      if (value.visible !== undefined) setVisible(value.visible);
      if (value.duplicate !== undefined) setDuplicate(value.duplicate);
      if (value.session !== undefined) setSession(value.session);
    }) };
  }, []);
  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark';
    if (entry.startsWith('web')) setThemeMode(next); else applyThemeMode(next);
    setDark(!dark);
  };
  return <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
    <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <button onClick={() => setSource(flow)}>Flow</button>
      <button onClick={() => setSource(sequence)}>Sequence</button>
      <button onClick={() => setSource('flowchart TD\n A[')}>Invalid</button>
      <button onClick={() => setSource('%%{init: {"suppressErrorRendering": false}}%%\nflowchart TD\n A[')}>
        Invalid directive</button>
      <button onClick={toggleTheme}>Theme</button>
      <button onClick={() => setVisible(value => !value)}>Mount</button>
      <button onClick={() => setMultiple(value => !value)}>Multiple</button>
    </nav>
    <div className={entry.startsWith('web') ? 'chat-page' : styles.page} style={{ display: 'block', height: 'auto' }}>
      <div className={entry === 'remote' ? 'gui-remote-workspace chat-page' : ''}>
        <article data-testid="message" style={{ minWidth: 0, width: '100%' }}>
          <FileEnvironmentContext.Provider value={entry === 'remote' ? remoteEnvironment : null}>
          {visible && (entry === 'local' ? <RichText key={session} text={text} />
            : <ChatMarkdown key={session} text={text} desktop={entry !== 'web-mobile'} />)}
          </FileEnvironmentContext.Provider>
        </article>
      </div>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
