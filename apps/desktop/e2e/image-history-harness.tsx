import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { Messages } from '../src/pages/codexGui/Messages';
import { ChatMessages } from '../../../shared/remote-chat/views/ChatMessages';
import { ChatImage, ChatImageContext } from '../../../shared/remote-chat/views/ChatImage';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';
import { RemoteUserMessage } from '../src/pages/codexGui/remote/RemoteUserMessage';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { initialChatState } from '../../../shared/remote-chat/client/types';
import { setThemeMode } from '../../web/src/theme/preference';
import type { Conversation } from '../../../shared/conversation/types';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { guiFontStyle, useGuiFontSize } from '../../../shared/appearance/fontSize';
import { ImageAiContext } from '../../../shared/chat/ImageAiContext';
import styles from '../../../shared/conversation/styles.module.less';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const mode = new URLSearchParams(location.search).get('mode') ?? 'local';
const controller = new ChatController(() => ({
  request: async () => { throw new Error('Unexpected request'); }, start() {}, stop() {},
}));
const unavailable = async (): Promise<never> => { throw new Error('Not part of the image fixture'); };
const environment: FileEnvironment = {
  remote: true, actions: { applications: unavailable, perform: unavailable },
  previews: { open: unavailable, close: unavailable }, resolveWebsite: unavailable,
  image: props => <ChatImage source={props.src} description={props.alt} compact={props.compact} />,
};
const load = async (threadId: string, source: string, original?: boolean) => {
  const response = await fetch('/image-preview.json', { method: 'POST',
    body: JSON.stringify({ threadId, source, original }) });
  return (await response.json()).url as string;
};

function Harness() {
  const fontSize = useGuiFontSize();
  const [value, setValue] = useState<Conversation>();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    void fetch('/history-fixture.json').then(response => response.json()).then(setValue);
    const update = (event: Event) => setValue((event as CustomEvent<Conversation>).detail);
    window.addEventListener('conversation-fixture', update);
    return () => window.removeEventListener('conversation-fixture', update);
  }, []);
  useEffect(() => {
    setThemeMode(dark ? 'dark' : 'light');
    const roles = { panel: 'surface', ink: 'ink', muted: 'muted', line: 'border', bg: 'canvas', green: 'accent' };
    for (const [role, appRole] of Object.entries(roles)) {
      document.documentElement.style.setProperty(`--${role}`, `var(--app-${appRole})`);
    }
  }, [dark]);
  const thread = value ? { ...value.thread, turns: value.turns } : null;
  const state = { ...initialChatState(), ready: true, selected: thread };
  const footer = <div className={mode === 'local' ? styles.composerWrap : 'chat-composer'}>
    <input aria-label="消息" placeholder="输入消息…" style={{ padding: 12, width: '100%' }} /></div>;
  const algorithm = [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    ...mode === 'web' ? [] : [theme.compactAlgorithm]];
  return <ApplicationTypography><ConfigProvider theme={{ algorithm }}><App>
    <ImageAiContext.Provider value={new URLSearchParams(location.search).has('editor')
      ? { enabled: true, send: async () => true } : null}>
    <main className={mode === 'local' ? `${styles.page} ${styles.collapsed}`
      : `chat-page ${mode === 'remote' ? `gui-remote-workspace ${styles.page} ${styles.collapsed}` : ''}`}
      style={{ height: '100vh', ...guiFontStyle(fontSize) }}>
      <div className={mode === 'local' ? styles.workspace : 'chat-conversation'}>
        <header style={{ padding: 12 }}><strong>Codex GUI · {mode}</strong>
          <button onClick={() => setDark(!dark)}>Theme</button></header>
        {mode === 'local' ? <Messages value={value} selected={value?.thread.id ?? null} footer={footer} />
          : <FileEnvironmentContext.Provider value={mode === 'remote' ? environment : null}>
            <ChatImageContext.Provider value={{ threadId: thread?.id ?? null, ready: true, load }}>
              <ChatMessages thread={thread} footer={footer} renderUserMessage={mode === 'remote'
                ? props => <RemoteUserMessage {...props} state={state} controller={controller} active /> : undefined} />
            </ChatImageContext.Provider>
          </FileEnvironmentContext.Provider>}
      </div>
    </main>
    </ImageAiContext.Provider>
  </App></ConfigProvider></ApplicationTypography>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
