// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TurnMessage } from './TurnMessage';
import { uiText } from '../../../../../shared/localization/uiText';
import type { Turn } from '../../../../../shared/conversation/types';

const counts = vi.hoisted(() => ({ rows: [] as string[], parses: [] as string[] }));
vi.mock('./useStreamingText', async original => {
  const actual = await original<typeof import('./useStreamingText')>();
  return { useStreamingText: (text: string, streaming: boolean) => {
    counts.rows.push(text); return actual.useStreamingText(text, streaming);
  } };
});
vi.mock('react-markdown', async original => {
  const actual = await original<typeof import('react-markdown')>();
  return { ...actual, default: (props: Parameters<typeof actual.default>[0]) => {
    counts.parses.push(props.children ?? ''); return actual.default(props);
  } };
});

it('keeps local historical rows and Markdown cached while fork actions use the newest callback', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); const root = createRoot(host);
  const history: Turn[] = Array.from({ length: 120 }, (_, index) => ({ id: `turn-${index}`, status: 'completed',
    items: [{ id: `item-${index}`, type: 'agentMessage', text: `History ${index}: **kept** $x^2$.` }] }));
  const original = vi.fn(); const current = vi.fn();
  const render = (callback: (id: string) => void) => act(async () => root.render(<>{history.map(turn =>
    <TurnMessage key={turn.id} turn={turn} active running={false} onFork={() => callback(turn.id)} />)}</>));
  try {
    await render(original); counts.rows = []; counts.parses = [];
    for (let index = 0; index < 40; index++) await render(current);
    process.stdout.write(`LOCAL_RENDER_COUNTS ${JSON.stringify({ rows: counts.rows.length,
      parses: counts.parses.length })}\n`);
    expect(counts.rows).toHaveLength(process.env.CHAT_RENDER_BASELINE ? 4800 : 0);
    expect(counts.parses).toHaveLength(0);
    const fork = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${uiText('client.conversation.branchIntoANewChat')}"]`)!;
    await act(async () => fork.click());
    expect(original).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledExactlyOnceWith('turn-0');
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
