import { afterEach, expect, it, vi } from 'vitest';
import { CliController } from '../../../shared/cli-gui/controller';
import type { CliHistory, CliRequest, CliSession } from '../../../shared/cli-gui/types';
import { createCliGuiFixture } from '../e2e/cli-gui-fixture';

afterEach(() => vi.useRealTimers());

async function setup(engine: 'claude' | 'gemini') {
  vi.useFakeTimers();
  const fixture = createCliGuiFixture();
  let changed = () => {};
  let pendingRead: Promise<CliHistory> | undefined;
  const calls: CliRequest[] = [];
  const controller = new CliController({
    subscribe: listener => { changed = listener; return () => { changed = () => {}; }; },
    request: async <T,>(input: CliRequest) => {
      calls.push(input);
      if (input.action === 'read' && pendingRead) return await pendingRead as T;
      return fixture.transport.request<T>(input);
    },
  });
  const stop = controller.start();
  await controller.refresh();
  await vi.advanceTimersByTimeAsync(0);
  const session = (await fixture.transport.request<CliSession[]>({
    engine, action: 'list', archived: false,
  }))[0];
  controller.open(session);
  await controller.refresh();
  await vi.advanceTimersByTimeAsync(0);
  calls.length = 0;
  return { controller, calls, fixture, changed: () => changed(), stop,
    holdRead: (promise: Promise<CliHistory>) => { pendingRead = promise; } };
}

it.each(['claude', 'gemini'] as const)('coalesces %s reply events without waiting for metadata', async engine => {
  const test = await setup(engine);
  for (let index = 0; index < 10; index++) test.changed();
  await vi.advanceTimersByTimeAsync(79);
  expect(test.calls).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(test.calls.map(call => call.action)).toEqual(['read']);
  test.changed();
  await vi.advanceTimersByTimeAsync(80);
  expect(test.calls.map(call => call.action)).toEqual(['read', 'read']);
  test.stop();
});

it('lets live events preempt the fallback poll and refreshes metadata less often', async () => {
  const test = await setup('claude');
  test.fixture.setHistory('claude', test.controller.getSnapshot().history!.entries, 'running');
  test.changed();
  await vi.advanceTimersByTimeAsync(80);
  test.calls.length = 0;
  test.changed();
  await vi.advanceTimersByTimeAsync(80);
  expect(test.calls.map(call => call.action)).toEqual(['read']);
  await vi.advanceTimersByTimeAsync(2200);
  expect(test.calls.filter(call => call.action === 'status')).toHaveLength(2);
  expect(test.calls.filter(call => call.action === 'list')).toHaveLength(2);
  test.stop();
});

it('runs one queued refresh after a slow read and keeps an explicit full refresh', async () => {
  const test = await setup('gemini');
  let finish!: (history: CliHistory) => void;
  test.holdRead(new Promise(resolve => { finish = resolve; }));
  test.changed();
  await vi.advanceTimersByTimeAsync(80);
  void test.controller.refresh();
  test.changed();
  await vi.advanceTimersByTimeAsync(80);
  expect(test.calls.map(call => call.action)).toEqual(['read']);
  finish(test.controller.getSnapshot().history!);
  await vi.advanceTimersByTimeAsync(0);
  expect(test.calls.map(call => call.action)).toEqual(['read', 'status', 'status', 'list', 'list', 'read']);
  test.stop();
});

it('keeps reads single-flight, queues one follow-up and drops it when stopped', async () => {
  const test = await setup('claude');
  let finish!: (history: CliHistory) => void;
  test.holdRead(new Promise(resolve => { finish = resolve; }));
  test.changed();
  await vi.advanceTimersByTimeAsync(80);
  for (let index = 0; index < 4; index++) {
    test.changed();
    await vi.advanceTimersByTimeAsync(80);
  }
  expect(test.calls.map(call => call.action)).toEqual(['read']);
  test.stop();
  finish(test.controller.getSnapshot().history!);
  await vi.advanceTimersByTimeAsync(5000);
  expect(test.calls.map(call => call.action)).toEqual(['read']);
});

it('keeps existing messages visible while a follow-up is sent', async () => {
  const test = await setup('gemini');
  const histories: (CliHistory | null)[] = [];
  test.controller.subscribe(() => histories.push(test.controller.getSnapshot().history));
  test.controller.edit('Follow-up');
  await test.controller.send();
  expect(histories.length).toBeGreaterThan(0);
  expect(histories.every(Boolean)).toBe(true);
  expect(test.controller.getSnapshot().draft).toBe('');
  test.stop();
});
