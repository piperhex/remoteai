import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { answer } from '../../../../shared/chat/lineBreakFixture.json';
import { ChatMarkdown } from './Markdown';

vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof React>(),
  memo: <T,>(component: T) => component,
  useMemo: <T,>(compute: () => T) => compute(),
  useState: <T,>(initial: T) => [initial, vi.fn()],
  useContext: () => undefined,

  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Text: 'Text', View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable',
  Linking: { openURL: vi.fn() }, StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock('./ChatCodeBlock', () => ({ ChatCodeBlock: 'Code' }));
vi.mock('./ChatDiff', () => ({ ChatDiff: 'Diff' }));
vi.mock('./ChatCodeReview', () => ({ ChatCodeReview: 'Review' }));
vi.mock('./ChatMath', () => ({ ChatMath: 'Math' }));
vi.mock('./ChatImage', () => ({ ChatImage: 'Image' }));
vi.mock('./ChatFilePreview', () => ({ ChatFileContext: {} }));
vi.mock('./SelectableChatText', () => ({ SelectableChatText: 'SelectableText' }));

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

// Render the actual Markdown components while leaving native layout to device verification.
function textContent(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (!isValidElement<{ children?: ReactNode }>(child)) return '';
    if (typeof child.type === 'function') {
      return textContent((child.type as (props: unknown) => ReactNode)(child.props));
    }
    return textContent(child.props.children);
  }).join('');
}

function nativeTextCount(node: ReactNode): number {
  return Children.toArray(node).reduce<number>((count, child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return count;
    if (typeof child.type === 'function') {
      return count + nativeTextCount((child.type as (props: unknown) => ReactNode)(child.props));
    }
    return count + Number(child.type === 'Text') + nativeTextCount(child.props.children);
  }, 0);
}

it.each([false, true])('keeps every model separator and answer line (user=%s)', user => {
  expect(textContent(<ChatMarkdown text={answer} user={user} />)).toBe(answer);
});

it('keeps soft and explicit breaks across inline formatting without inserting blank lines', () => {
  expect(textContent(<ChatMarkdown text={'第一行\n**第二行**  \n第三行\\\n第四行'} />))
    .toBe('第一行\n第二行\n第三行\n第四行');
});

it('keeps long streamed paragraphs below the Android text span limit', () => {
  const lines = Array.from({ length: 240 }, (_, index) => `C${index + 1} A short sentence about nature.`);
  for (const length of [60, 120, 240]) {
    const text = lines.slice(0, length).join('\n');
    const rendered = <ChatMarkdown text={text} />;
    expect(textContent(rendered)).toBe(text);
    // A native Text wrapper per line exhausts Android's span priority and floods both UI and JS threads.
    expect(nativeTextCount(rendered)).toBeLessThan(10);
  }
});

it('preserves styled and linked text between plain multiline runs', () => {
  const text = '第一行\n第二行 **加粗\n仍然加粗**\n[链接](https://example.com)\n`code`\n~~删除~~';
  const rendered = <ChatMarkdown text={text} />;
  expect(textContent(rendered)).toBe('第一行\n第二行 加粗\n仍然加粗\n链接\ncode\n删除');
  expect(nativeTextCount(rendered)).toBe(4);
});
