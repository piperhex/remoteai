import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RichText } from '../src/pages/codexGui/RichText';
import { ChatMarkdown } from '../../web/src/chat/ChatMarkdown';
import { applyThemeMode } from '../src/utils/themeMode';
import { setThemeMode } from '../../web/src/theme/preference';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import styles from '../src/pages/codexGui/styles.module.less';

const entry = new URLSearchParams(location.search).get('entry') ?? 'local';
if (entry === 'web') {
  await import('../../web/src/styles.css');
  await import('../../web/src/chat/messages.css');
} else {
  await import('../src/styles.css');
  if (entry === 'remote') await import('../src/pages/codexGui/remote/remoteGui.less');
}
setInterfaceLanguage('zh');
const flow = 'flowchart LR\n A[提交问题] --> B{需要工具？}\n B -->|是| C[执行工具]\n B -->|否| D[生成答复]\n C --> D';
const sequence = 'sequenceDiagram\n participant U as 用户\n participant A as 助手\n U->>A: 发送消息\n A-->>U: 展示结果';
const markdown = (source: string) => '```mermaid\n' + source + '\n```';

function Harness() {
  const [dark, setDark] = useState(false);
  const [source, setSource] = useState(flow);
  const [visible, setVisible] = useState(true);
  const [multiple, setMultiple] = useState(false);
  const text = markdown(source) + (multiple ? '\n\n' + markdown(sequence) : '');
  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark';
    if (entry === 'web') setThemeMode(next); else applyThemeMode(next);
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
    <div className={entry === 'web' ? 'chat-page' : styles.page} style={{ display: 'block', height: 'auto' }}>
      <div className={entry === 'remote' ? 'gui-remote-workspace chat-page' : ''}>
        <article data-testid="message" style={{ minWidth: 0, width: '100%' }}>
          {visible && (entry === 'local' ? <RichText text={text} /> : <ChatMarkdown text={text} desktop />)}
        </article>
      </div>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
