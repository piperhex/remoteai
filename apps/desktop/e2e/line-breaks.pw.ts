import { expect, test } from '@playwright/test';
import lineBreaks from '../../../shared/chat/lineBreakFixture.json' with { type: 'json' };
import type { Conversation } from '../../../shared/conversation/types';

const { answer } = lineBreaks;

function conversation(text: string, streaming: boolean): Conversation {
  return { thread: { id: 'line-breaks', cwd: '', preview: '', updatedAt: 1 },
    activeTurn: streaming ? 'turn' : null, tokens: 0, error: '', turns: [{ id: 'turn',
      status: streaming ? 'inProgress' : 'completed', items: [
        { id: 'answer', type: 'agentMessage', phase: 'final_answer', text },
      ] }] };
}

for (const width of [390, 1280]) {
  test(`keeps answer lines during streaming and history reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let fixture = conversation(answer.split('\n').slice(0, 5).join('\n'), true);
    await page.route('**/history-fixture.json', route => route.fulfill({ json: fixture }));
    await page.goto('/e2e/tool-history-harness.html');
    const body = page.locator('[data-quote-source="answer"] p');
    await expect.poll(() => body.innerText()).toBe(fixture.turns[0].items[0].text);
    fixture = conversation(answer, false);
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('conversation-fixture', { detail: value })),
      fixture);
    await expect.poll(() => body.innerText()).toBe(answer);
    expect(await body.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await body.screenshot({ path: `../../.codex-tmp/linebreak-display/desktop-${width}.png` });
    await page.reload();
    await expect.poll(() => body.innerText()).toBe(answer);
  });
}
