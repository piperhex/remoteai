// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ChatMarkdown } from '../../../../shared/remote-chat/views/ChatMarkdown';
import { ChatFileContext } from '../../../../shared/remote-chat/views/ChatFileLink';
import { getLanguage, setLanguage, t } from '../../../../shared/localization/browserClient';
import type { FilePreviewContext } from '../../../../shared/remote-chat/views/ChatFilePreview';

const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock('react-markdown', async original => {
  const actual = await original<typeof import('react-markdown')>();
  return { ...actual, default: (props: Parameters<typeof actual.default>[0]) => {
    parses.count++; return actual.default(props);
  } };
});

it('updates context consumers without parsing, but invalidates content, mode and language semantics', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); const root = createRoot(host);
  const originalLanguage = getLanguage();
  const context: FilePreviewContext = { ready: false, threadId: 'one', load: vi.fn(),
    client: { open: vi.fn(), read: vi.fn(), close: vi.fn() } };
  const text = '[Document](F:/doc.md)\n\n```js\nconst value = 1;\n```';
  const render = (props: { ready: boolean; desktop?: boolean; text?: string }) => act(async () => root.render(
    <ChatFileContext.Provider value={{ ...context, ready: props.ready }}>
      <ChatMarkdown text={props.text ?? text} desktop={props.desktop} />
    </ChatFileContext.Provider>));
  try {
    await render({ ready: false }); parses.count = 0;
    const documentButton = host.querySelector<HTMLButtonElement>('.chat-file-link button')!;
    expect(documentButton.disabled).toBe(true);
    await render({ ready: true });
    expect(documentButton.disabled).toBe(false); expect(parses.count).toBe(0);
    await render({ ready: true, desktop: true }); expect(parses.count).toBe(1);
    await render({ ready: true, desktop: true, text: text.replace('1;', '2;') });
    expect(parses.count).toBe(2); expect(host.querySelector('pre')?.textContent).toContain('2;');
    await act(async () => setLanguage(originalLanguage === 'ja' ? 'en' : 'ja'));
    expect(parses.count).toBe(3);
    expect(host.querySelector(`button[aria-label="${t('client.chat.copyCode')}"]`)).not.toBeNull();
  } finally {
    await act(async () => root.unmount()); setLanguage(originalLanguage); vi.unstubAllGlobals();
  }
});
