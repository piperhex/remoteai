import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import type { GuiEvent } from '../../../shared/remote-chat/client/types';
import { ChatThreads } from '../src/chat/ChatThreads';
import { ChatSidebar } from '../src/chat/ChatSidebar';
import '../src/styles.css';
import '../src/chat/chat.css';

function createController() {
  return new ChatController(events => {
    const receive = (event: Event) => events.event((event as CustomEvent<GuiEvent>).detail);
    return {
      start() {
        window.addEventListener('test-chat-event', receive);
        events.mode('relay'); events.ready();
      },
      stop() { window.removeEventListener('test-chat-event', receive); },
      async request<T>(method: string, body?: unknown): Promise<T> {
        if (method === 'connect') return [] as T;
        const input = body as { operation: string; cursor?: string; archived?: boolean };
        if (input.operation !== 'list') return { data: [], nextCursor: null } as T;
        const query = new URLSearchParams({ cursor: input.cursor ?? '', archived: String(input.archived) });
        const response = await fetch(`/web/thread-page?${query}`);
        if (!response.ok) throw new Error('加载失败');
        return response.json();
      },
    };
  });
}

function Harness() {
  const [controller] = useState(createController);
  const [open, setOpen] = useState(true);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  return <main className="chat-page" style={{ height: '100dvh' }}>
    <ChatSidebar desktop={window.innerWidth > 860} open={open} onClose={() => setOpen(false)}>
      <ChatThreads state={state} controller={controller} newChat={() => {}} onClose={() => setOpen(false)}
        openSearch={() => {}} profile={null} />
    </ChatSidebar>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
