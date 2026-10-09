import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatMessages } from '../src/chat/ChatMessages';
import { ChatProcessing } from '../src/chat/ChatProcessing';
import { ChatQuotesProvider } from '../src/chat/ChatQuotes';
import { ChatDetailsWorkspace } from '../src/chat/ChatDetailsWorkspace';
import { ConversationChangesButton } from '../../desktop/src/pages/codexGui/ConversationChangesButton';
import { useDesktopLayout } from '../src/useDesktopLayout';
import type { Thread } from '../src/chat/types';
import '../src/styles.css';
import '../src/chat/chat.css';

function Harness() {
  const desktop = useDesktopLayout();
  const [thread, setThread] = useState<Thread | null>(null);
  const [hasMore, setHasMore] = useState(new URLSearchParams(location.search).has('history'));
  const [loadingMore, setLoadingMore] = useState(false);
  const runningTurn = thread?.turns?.find(turn => turn.status === 'inProgress');
  const loadOlder = async () => {
    setLoadingMore(true);
    try {
      const response = await fetch('/web/display-history.json');
      const page: { turns: NonNullable<Thread['turns']>; hasMore: boolean } = await response.json();
      setThread(current => current && { ...current, turns: [...page.turns, ...(current.turns ?? [])] });
      setHasMore(page.hasMore);
    } finally { setLoadingMore(false); }
  };
  useEffect(() => {
    void fetch('/web/display-fixture.json').then(response => response.json()).then(setThread);
  }, []);
  useEffect(() => {
    const update = (event: Event) => setThread((event as CustomEvent<Thread>).detail);
    window.addEventListener('display-fixture', update);
    return () => window.removeEventListener('display-fixture', update);
  }, []);
  return <ChatQuotesProvider scope={thread?.id ?? null} enabled sending={false}>
    <main className="chat-page" style={{ height: '100vh' }}>
      <ChatDetailsWorkspace selected={thread?.id ?? null} active enabled={desktop}>
      <div className="chat-conversation">
        <header className="chat-header"><h2>对话展示回归</h2>
          {desktop && <ConversationChangesButton value={thread?.turns ? { turns: thread.turns } : undefined} />}
        </header>
        <ChatMessages key={thread?.id} thread={thread} hasMore={hasMore}
          loadingMore={loadingMore} loadOlder={loadOlder}
          processing={runningTurn && <ChatProcessing key={runningTurn.id} turn={runningTurn} active />} />
        <footer style={{ padding: 20 }}><input aria-label="消息" placeholder="输入消息…" /></footer>
      </div>
      </ChatDetailsWorkspace>
    </main>
  </ChatQuotesProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
