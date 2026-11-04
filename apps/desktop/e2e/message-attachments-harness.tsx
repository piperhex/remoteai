import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { UserMessage } from '../src/pages/codexGui/UserMessage';
import { RemoteUserMessage } from '../src/pages/codexGui/remote/RemoteUserMessage';
import { ChatMessage } from '../../../shared/remote-chat/views/ChatMessage';
import { useDesktopLayout } from '../../../shared/layout/useDesktopLayout';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { initialChatState, type Item } from '../../../shared/remote-chat/client/types';
import { setLanguage, useLanguage } from '../../../shared/localization/browserClient';
import { setThemeMode } from '../../web/src/theme/preference';
import { ComposerReferences } from '../src/pages/codexGui/ComposerReferences';
import { ComposerAttachments } from '../../../shared/remote-chat/views/ComposerAttachments';
import { AttachmentMetadataContext } from '../../../shared/chat/attachmentMetadata';
import type { AttachmentReference } from '../../../shared/conversation/attachmentTypes';
import type { Language } from '../../../shared/localization/language';
import styles from '../../../shared/conversation/styles.module.less';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import '../../../shared/remote-chat/views/messages.css';
import '../../../shared/remote-chat/views/desktopMessages.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const mode = new URLSearchParams(location.search).get('mode');
const showComposer = new URLSearchParams(location.search).has('composer');
const readMetadata = (path: string) => fetch('/attachment-metadata.json', {
  method: 'POST', body: JSON.stringify({ path, mode }),
}).then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); });
const controller = new ChatController(() => ({
  request: async () => { throw new Error('Unexpected request'); }, start: () => {}, stop: () => {},
}));

function Harness() {
  useLanguage();
  const desktop = useDesktopLayout();
  const [item, setItem] = useState<Item>();
  const [dark, setDark] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentReference[]>([]);
  useEffect(() => {
    setThemeMode(dark ? 'dark' : 'light');
    document.documentElement.style.setProperty('--panel', 'var(--app-surface, #fff)');
  }, [dark]);
  useEffect(() => { void fetch('/attachments-fixture.json').then(response => response.json()).then(setItem); }, []);
  useEffect(() => {
    if (showComposer) void fetch('/composer-attachments.json').then(response => response.json()).then(setAttachments);
  }, []);
  const turn = { id: 'turn', status: 'completed', items: item ? [item] : [] };
  const thread = { id: 'thread', cwd: '', preview: '', updatedAt: 1, turns: [turn] };
  const state = { ...initialChatState(), ready: true, selected: thread };
  const message = item && (mode === 'web' ? <ChatMessage item={item} desktop={desktop} onOpen={() => {}} />
    : mode === 'remote' ? <RemoteUserMessage item={item} turn={turn} state={state} controller={controller} active />
      : <UserMessage item={item} onEdit={async () => true} />);
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: { motion: false } }}>
    <nav><button onClick={() => setDark(!dark)}>Theme</button>
      {(['zh', 'en', 'ja', 'ru'] satisfies Language[]).map(language =>
        <button key={language} onClick={() => setLanguage(language)}>{language}</button>)}</nav>
    <AttachmentMetadataContext.Provider value={readMetadata}>
    <main className={mode === 'web' ? 'chat-page' : `${styles.page} ${styles.collapsed}
      ${mode === 'remote' ? 'chat-page gui-remote-workspace' : ''}`}>
      <div className={mode === 'local' ? styles.workspace : 'chat-conversation'}>
        <div className="chat-message-region"><div className="chat-message-content" style={{ padding: 24 }}>
          {message}
          {showComposer && <div className="chat-composer">
            {mode === 'local' ? <ComposerReferences items={attachments} disabled={false}
              onRemove={path => setAttachments(items => items.filter(item => item.path !== path))} />
              : <ComposerAttachments items={attachments} busy={false} active ready
                remove={item => setAttachments(items => items.filter(value => value !== item))} />}
            <textarea aria-label="Message" /></div>}
        </div></div>
      </div>
    </main>
    </AttachmentMetadataContext.Provider>
  </ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
