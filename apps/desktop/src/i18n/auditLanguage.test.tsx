// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatDevices } from '../../../../shared/remote-chat/views/ChatDevices';
import { DesktopClipboardNotice } from '../../../../shared/remote-desktop/views/DesktopClipboardNotice';
import type { useDesktopClipboard } from '../../../../shared/remote-desktop/views/useDesktopClipboard';
import { messageSections } from '../../../../shared/chat/messageDetails';
import { setInterfaceLanguage } from '../../../../shared/localization/interfaceLanguage';
import { displayText, translateMessage } from '../../../../shared/localization/messages';
import { remoteErrorText } from '../../../../shared/localization/errors';

vi.mock('../../../../shared/layout/AdaptiveSheet', () => ({
  AdaptiveSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../../shared/layout/useDesktopLayout', () => ({ useDesktopLayout: () => true }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setInterfaceLanguage('zh');
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  setInterfaceLanguage('zh');
  vi.unstubAllGlobals();
});

it('switches the local computer label and matches its translated name regardless of case', async () => {
  await act(async () => root.render(<ChatDevices devices={[]} choose={() => {}} chooseLocal={() => {}}
    onClose={() => {}} />));
  for (const language of ['en', 'ru', 'ja', 'zh'] as const) {
    await act(async () => setInterfaceLanguage(language));
    expect(container.querySelector('strong')?.textContent)
      .toBe(translateMessage(language, 'client.composer.thisComputer'));
  }
  await act(async () => setInterfaceLanguage('en'));
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'THIS');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector('strong')?.textContent).toBe('This computer');
});

it('translates tool detail titles while preserving tool output and user-owned paths', () => {
  const sections = messageSections({ id: 'tool', type: 'mcpToolCall', command: 'echo 测试', cwd: '用户目录',
    arguments: { name: '用户名称' }, output: '原始输出', exitCode: 0 });
  for (const language of ['zh', 'en', 'ru', 'ja'] as const) {
    setInterfaceLanguage(language);
    expect(sections.map(section => displayText(section.title))).toEqual([
      'client.chat.command', 'client.shared.workingDirectory', 'client.shared.arguments',
      'client.chat.output', 'client.shared.exitCode',
    ].map(key => displayText(key)));
    expect(sections.map(section => section.text)).toContain('原始输出');
    expect(sections.map(section => section.text)).toContain('用户目录');
  }
});

it('decodes canonical clipboard feedback for Web and the embedded desktop remote view', async () => {
  const clipboard = { open: false, status: '正在传输剪贴板…', progress: 42,
    received: undefined, needsSave: false } as ReturnType<typeof useDesktopClipboard>;
  for (const language of ['zh', 'en', 'ru', 'ja'] as const) {
    await act(async () => { setInterfaceLanguage(language); root.render(<DesktopClipboardNotice clipboard={clipboard} />); });
    expect(container.textContent).toBe(`${remoteErrorText(clipboard.status, language)} 42%`);
    if (language === 'en' || language === 'ru') expect(container.textContent).not.toMatch(/\p{Script=Han}/u);
  }
});
