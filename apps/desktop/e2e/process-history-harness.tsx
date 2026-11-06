import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { ProcessDetailsContext, type ProcessDetailsLoader } from '../../../shared/chat/DeferredProcessDetails';
import { ToolDetailsContext, type ToolDetailsLoader } from '../../../shared/chat/DeferredToolDetails';
import { conversation } from '../../../shared/conversation/events';
import type { Thread } from '../../../shared/conversation/types';
import type { HistoryPage } from '../../../shared/remote-chat/historyPage';
import { ChatMessages } from '../../../shared/remote-chat/views/ChatMessages';
import { darkColors } from '../../../shared/theme/mode';
import { Messages } from '../src/pages/codexGui/Messages';
import styles from '../../../shared/conversation/styles.module.less';
import '../../../shared/remote-chat/views/chat.css';

interface Page { thread: Thread; page: HistoryPage }
const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
if (dark) for (const [role, color] of Object.entries(darkColors)) {
  document.documentElement.style.setProperty(`--app-${role}`, color);
}
const load: ProcessDetailsLoader = target => fetch(`process-details.json?${new URLSearchParams(target)}`)
  .then(response => { if (!response.ok) throw new Error('Failed'); return response.json(); });
const loadTool: ToolDetailsLoader = target => fetch(`tool-details.json?${new URLSearchParams(target)}`)
  .then(response => response.json());

function Harness() {
  const [value, setValue] = useState<Page>();
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(true);
  useEffect(() => { void fetch('process-history.json').then(response => response.json()).then(setValue); }, []);
  const older = async () => {
    setLoading(true);
    try {
      const response = await fetch(`process-history.json?cursor=${encodeURIComponent(JSON.stringify(value?.page.start))}`);
      const next: Page = await response.json();
      setValue(next);
      return next.thread.turns;
    } finally { setLoading(false); }
  };
  const footer = <div style={{ padding: 16 }}><input aria-label="消息" placeholder="输入消息…" /></div>;
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  return <ConfigProvider theme={{ algorithm: mode === 'web' ? algorithm : [algorithm, theme.compactAlgorithm] }}>
    <ApplicationTypography><App><ProcessDetailsContext.Provider value={{ load, active }}>
      <ToolDetailsContext.Provider value={{ load: loadTool, active }}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: 16, display: 'flex', gap: 24 }}>
          <strong>{mode === 'local' ? '桌面本地' : mode === 'remote' ? '桌面远程' : 'Web'} · 处理过程</strong>
          <button onClick={() => setActive(!active)}>{active ? '离开对话' : '返回对话'}</button>
        </header>
        <main className={mode === 'local' ? `${styles.page} ${styles.collapsed}` : 'chat-page'}
          style={{ flex: 1, minHeight: 0 }} hidden={!active}>
          {mode === 'local' ? <div className={styles.workspace}>
            <Messages selected={value?.thread.id ?? null}
              value={value ? { ...conversation(value.thread), historyPage: value.page } : undefined}
              active={active} onLoadOlder={older} footer={footer} />
          </div> : <div className="chat-conversation">
            <ChatMessages thread={value?.thread ?? null} hasMore={value?.page.hasMore}
              loadingMore={loading} loadOlder={async () => { await older(); }} footer={footer} />
          </div>}
        </main>
      </div>
    </ToolDetailsContext.Provider></ProcessDetailsContext.Provider></App></ApplicationTypography>
  </ConfigProvider>;
}

const css = document.createElement('style');
css.textContent = '*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif}'
  + '[hidden]{display:none!important}:root{--ink:#233329;--panel:#fff;--line:#dfe6e1;'
  + '--muted:#66796d;--green:#168348;--green-dark:#126a3b;--green-soft:#e7f4ec}'
  + ':root[data-theme=dark]{color-scheme:dark;--ink:#e6e8eb;--muted:#9298a1;--line:#2b2f33;--panel:#17191c}';
document.head.append(css);
createRoot(document.getElementById('root')!).render(<Harness />);
