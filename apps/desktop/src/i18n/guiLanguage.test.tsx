// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setGuiLanguage, uiText } from '../../../../shared/localization/uiText';
import { MessageItem } from '../pages/codexGui/MessageItem';
import { RichText } from '../../../../shared/conversation/RichText';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setGuiLanguage('zh');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setGuiLanguage('zh');
  vi.unstubAllGlobals();
});

it('refreshes memoized message actions and code labels without resetting local state or content', async () => {
  const text = '取消 / keep this user content';
  await act(async () => root.render(<>
    <MessageItem item={{ id: 'message', type: 'userMessage', content: [{ type: 'text', text }] }}
      streaming={false} onEdit={vi.fn()} />
    <RichText text={'```text\nconst label = "取消";\n```'} />
  </>));
  const wrap = container.querySelector<HTMLButtonElement>('[aria-label="自动换行"]');
  expect(wrap).not.toBeNull();
  await act(async () => wrap?.click());
  for (const language of ['ru', 'ja', 'en', 'zh'] as const) {
    await act(async () => setGuiLanguage(language));
    expect(container.querySelector(`[aria-label="${uiText("client.workspaceActions.editMessage")}"]`)).not.toBeNull();
    const translatedWrap = container.querySelector(`[aria-label="${uiText("client.projectBrowser.wrapLines")}"]`);
    expect(translatedWrap).toBe(wrap);
    expect(translatedWrap?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain(text);
    expect(container.querySelector('pre')?.textContent).toContain('const label = "取消";');
  }
});
