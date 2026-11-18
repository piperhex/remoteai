// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RichText } from '../../../../../shared/conversation/RichText';
import { ChatMarkdown } from '../../../../../shared/remote-chat/views/ChatMarkdown';

const parses = vi.hoisted(() => [] as string[]);
vi.mock('react-markdown', async original => {
  const actual = await original<typeof import('react-markdown')>();
  return { ...actual, default: (props: Parameters<typeof actual.default>[0]) => {
    parses.push(props.children ?? '');
    return actual.default(props);
  } };
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  root = createRoot(host);
  parses.length = 0;
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

type Renderer = ComponentType<{ text: string; streaming?: boolean }>;
const render = (View: Renderer, text: string, streaming = true, key = 'draft') =>
  act(async () => root.render(<View key={key} text={text} streaming={streaming} />));
const section = (index: number) => `### Section ${index}\n\n${'**Completed** work and checks. '.repeat(9)}\n\n`;

it.each([['desktop local', RichText], ['remote and web', ChatMarkdown]] as const)(
  '%s reuses formatted history while the stream advances', async (_, View) => {
    let text = Array.from({ length: 24 }, (_, index) => section(index)).join('');
    await render(View, text);
    const first = host.querySelector('h3');
    expect(first?.textContent).toBe('Section 0');
    const sealed = parses[0];
    parses.length = 0;
    for (let index = 24; index < 35; index++) {
      text += section(index);
      await render(View, text);
    }
    expect(host.querySelector('h3')).toBe(first);
    expect(host.querySelectorAll('h3')).toHaveLength(35);
    expect(parses).not.toContain(sealed);
    expect(parses.every(part => part.length < 4_096)).toBe(true);
    const streamed = host.innerHTML;
    await render(View, text, false);
    expect(host.querySelector('h3')).toBe(first);
    await render(View, text, false, 'history');
    expect(host.innerHTML).toBe(streamed);
  },
);

it('keeps list continuations, fences, tables and multiline formulas together', async () => {
  const text = `${section(0)}${section(1)}${section(2)}${section(3)}`
    + '- A list item\n\n  Continued paragraph\n\n- Another item\n\n'
    + '```python\nfor name in names[1:]:\n\n### Still code\n\n    print(name)\n```\n\n'
    + '| Key | Value |\n| --- | --- |\n| A | B |\n\n'
    + '\\[\nx^2 + y^2\n\n= z^2\n\\]\n\n'
    + `${section(4)}${section(5)}${section(6)}${section(7)}${section(8)}`;
  await render(ChatMarkdown, text);
  expect(host.querySelectorAll('ul li')).toHaveLength(2);
  expect(host.querySelector('pre')?.textContent).toContain('### Still code');
  expect(host.querySelector('td')?.textContent).toBe('A');
  expect(host.querySelector('.katex-display')).toBeTruthy();
  expect(parses.length).toBeGreaterThan(1);
  const streamed = host.innerHTML;
  await render(ChatMarkdown, text, false, 'history');
  expect(host.innerHTML).toBe(streamed);
});

it('resolves a reference added after its label has already been rendered', async () => {
  const text = '[Read the guide][guide]\n\n' + Array.from({ length: 10 }, (_, index) => section(index)).join('');
  await render(ChatMarkdown, text);
  expect(host.querySelector('a')).toBeNull();
  await render(ChatMarkdown, `${text}[guide]: https://example.com/guide\n`);
  expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/guide');
});

it('bounds reparsing of one large unfinished block and preserves its full text on completion', async () => {
  const text = 'a'.repeat(4_095) + '🙂'.repeat(3_000);
  await render(ChatMarkdown, text);
  expect(host.textContent).toBe(text);
  expect(parses[0]).toHaveLength(4_095);
  parses.length = 0;
  await render(ChatMarkdown, text + ' added');
  expect(parses).toHaveLength(0);
  await render(ChatMarkdown, text + ' complete', false);
  expect(host.querySelectorAll('.chat-markdown > p')).toHaveLength(1);
  expect(host.textContent).toBe(text + ' complete');
});
