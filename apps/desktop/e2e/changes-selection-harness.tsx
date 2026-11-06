import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { DiffTextContext } from '../../../shared/chat/diffText';
import { displayText } from '../../../shared/localization/browserClient';
import { gitApi } from '../../../shared/conversation/gitApi';
import { darkColors } from '../../../shared/theme/mode';
import { ConversationChangesButton } from '../../../shared/conversation/ConversationChangesButton';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { conversation } from '../../../shared/conversation/events';
import type { Thread } from '../../../shared/conversation/types';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { ChatMessages } from '../../../shared/remote-chat/views/ChatMessages';
import { Messages } from '../src/pages/codexGui/Messages';
import styles from '../../../shared/conversation/styles.module.less';
import '../src/styles.css';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
if (dark) {
  for (const [role, color] of Object.entries(darkColors)) {
    document.documentElement.style.setProperty(`--app-${role}`, color);
  }
  document.documentElement.style.setProperty('--panel', darkColors.surface);
}
gitApi.undo = async () => ({ undone: false });

function Harness() {
  const [thread, setThread] = useState<Thread>();
  useEffect(() => {
    void fetch('changes-selection.json').then(response => response.json()).then(setThread);
  }, []);
  const value = thread ? conversation(thread) : undefined;
  const header = <header className="chat-header" style={{ padding: 16, display: 'flex', gap: 24 }}>
    <strong>{mode} · Conversation changes</strong><ConversationChangesButton value={value} />
  </header>;
  const footer = <div style={{ padding: 16 }}><input aria-label="Message" placeholder="Message" /></div>;
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  return <ConfigProvider theme={{ algorithm: mode === 'web' ? algorithm : [algorithm, theme.compactAlgorithm] }}>
    <ApplicationTypography><App><DiffTextContext.Provider value={displayText}>
      <main className={mode === 'local' ? `${styles.page} ${styles.collapsed}`
        : mode === 'remote' ? `${styles.page} chat-page gui-remote-workspace` : 'chat-page'}
        style={{ width: '100vw', height: '100vh' }}>
        {mode === 'local' ? <DetailsWorkspace selected={thread?.id ?? null} active>
          <div className={styles.workspace} style={{ height: '100%' }}>{header}
            <Messages selected={thread?.id ?? null} value={value} active footer={footer} />
          </div>
        </DetailsWorkspace> : <ChatDetailsWorkspace selected={thread?.id ?? null} active enabled>
          <div className="chat-conversation">{header}<ChatMessages thread={thread ?? null} footer={footer} /></div>
        </ChatDetailsWorkspace>}
      </main>
    </DiffTextContext.Provider></App></ApplicationTypography>
  </ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
