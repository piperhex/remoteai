import { test, expect } from '@playwright/test';
import type { Conversation, Thread } from '../../../shared/conversation/types';

test('lifecycle-only resumes preserve paged history between consecutive sends', async ({ page }, testInfo) => {
  page.on('pageerror', error => console.error('Harness error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Browser error:', message.text()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  let previous: Conversation = {
    thread: { id: 'resume-fixture', cwd: '/project', preview: '', updatedAt: 1 },
    activeTurn: null, error: '', tokens: 0,
    historyPage: { hasMore: true, start: { turnId: 'old-0', itemId: 'answer-0' } },
    turns: Array.from({ length: 24 }, (_, index) => ({ id: `old-${index}`, status: 'completed',
      items: [{ id: `answer-${index}`, type: 'agentMessage', phase: 'final_answer',
        text: `Saved answer ${index}: retained after resuming this conversation.` }] })),
  };
  await page.route('**/history-fixture.json', route => route.fulfill({ json: previous }));
  const fixtureResponse = page.waitForResponse(response => response.url().endsWith('/history-fixture.json'));
  await page.goto('/e2e/tool-history-harness.html');
  expect((await (await fixtureResponse).json()).turns).toHaveLength(24);
  await expect(page.locator('[data-message-id="answer-23"]')).toBeVisible();
  for (let index = 1; index <= 2; index++) {
    const latest = previous.turns.at(-1)!;
    const thread: Thread = { ...previous.thread, turns: [{ ...latest, items: [] }] };
    const resumed = await page.evaluate(async ({ thread, previous }) => {
      const modulePath = '/src/pages/codexGui/conversationSnapshot.ts';
      const { resumedConversationSnapshot } = await import(modulePath);
      return resumedConversationSnapshot(thread, previous);
    }, { thread, previous }) as Conversation;
    expect(resumed.turns).toEqual(previous.turns);
    expect(resumed.historyPage).toEqual(previous.historyPage);
    previous = { ...resumed, turns: [...resumed.turns, { id: `new-${index}`, status: 'completed',
      items: [{ id: `new-answer-${index}`, type: 'agentMessage', phase: 'final_answer',
        text: `New answer ${index}: earlier answers are still retained.` }] }] };
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('conversation-fixture', { detail })), previous);
    await expect(page.locator(`[data-message-id="new-answer-${index}"]`)).toBeVisible();
  }
  expect(previous.turns).toHaveLength(26);
  await page.screenshot({ path: testInfo.outputPath('desktop-history-after-resume.png'), animations: 'disabled' });
});
