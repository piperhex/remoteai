import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { DiffView } from '../src/pages/codexGui/DiffView';
import { RunningChangesSummary } from '../src/pages/codexGui/RunningChangesSummary';
import { useTurnChangedFiles } from '../../../shared/conversation/useTurnChangedFiles';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { ChatTurnSummary, type TurnPanel } from '../../../shared/remote-chat/views/ChatTurnSummary';
import { ChatTurnDetails } from '../../../shared/remote-chat/views/ChatTurnDetails';
import type { Turn } from '../../../shared/conversation/types';
import { useDesktopLayout } from '../../../shared/layout/useDesktopLayout';
import { DiffTextContext } from '../../../shared/chat/diffText';
import { displayText } from '../../../shared/localization/browserClient';
import '../src/styles.css';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import '../../../shared/remote-chat/views/messages.css';
import '../../../shared/remote-chat/views/desktopMessages.css';

interface Fixture { threadId: string; turn: Turn }
const mode = new URLSearchParams(location.search).get('mode') ?? 'web';
function LocalSummary({ turn, threadId }: { turn: Turn; threadId: string }) {
  const files = useTurnChangedFiles(turn);
  if (turn.status === 'inProgress') return <div data-testid="local-running"><RunningChangesSummary value={{
    thread: { id: threadId, cwd: '/fixture', preview: '', updatedAt: 1 },
    turns: [turn], activeTurn: turn.id, tokens: 0, error: '',
  }} /></div>;
  return <DiffView files={files} title="client.chat.changesThisTurn" />;
}

function Harness() {
  const [fixture, setFixture] = useState<Fixture>();
  const [panel, setPanel] = useState<TurnPanel>();
  const desktop = useDesktopLayout();
  useEffect(() => {
    void fetch('diff-cache-fixture.json').then(response => response.json()).then(setFixture);
    const update = (event: Event) => setFixture((event as CustomEvent<Fixture>).detail);
    window.addEventListener('diff-cache-fixture', update);
    return () => window.removeEventListener('diff-cache-fixture', update);
  }, []);
  useEffect(() => setPanel(undefined), [fixture?.threadId]);
  if (!fixture) return null;
  const { turn, threadId } = fixture;
  const content = <div style={{ padding: desktop ? 32 : 16, maxWidth: 960, margin: '0 auto', width: '100%' }}>
    <p>Diff cache regression · {mode}</p>
    <p data-testid="answer">{turn.items.find(item => item.type === 'agentMessage')?.text}</p>
    {mode === 'local' ? <LocalSummary turn={turn} threadId={threadId} />
      : <ChatTurnSummary turn={turn} onOpen={setPanel} />}
    {panel && <ChatTurnDetails turn={turn} panel={panel} onClose={() => setPanel(undefined)} />}
  </div>;
  return <main className="chat-page" style={{ display: 'block', width: '100vw', height: '100vh', minWidth: 0 }}>
    <DiffTextContext.Provider value={displayText}>
      {mode === 'local' ? <DetailsWorkspace selected={threadId} active>{content}</DetailsWorkspace>
        : <ChatDetailsWorkspace selected={threadId} active enabled={desktop}>{content}</ChatDetailsWorkspace>}
    </DiffTextContext.Provider>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
