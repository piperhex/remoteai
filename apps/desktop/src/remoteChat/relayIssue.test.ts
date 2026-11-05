import { afterEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { visibleChatError } from '../../../../shared/remote-chat/chatError';
import { CONNECTION_ERRORS } from '../../../../shared/remote-chat/connectionErrors';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function harness() {
  let events!: ConnectionEvents;
  const controller = new ChatController(callbacks => {
    events = callbacks;
    return { start: () => events.mode('connecting'), stop: () => {},
      request: async <T>() => ({ data: [], nextCursor: null }) as T };
  });
  controller.start();
  const notice = () => visibleChatError(controller.snapshot().error, controller.snapshot());
  return { controller, events, notice };
}

it.each(['unavailable', 'quota'] as const)('hides relay %s when P2P recovers without another ready event', reason => {
  vi.useFakeTimers();
  const { controller, events, notice } = harness();
  events.mode('relay');
  events.mode('connecting');
  events.relayIssue?.(reason);
  expect(notice()).not.toBe('');
  events.mode('direct');
  expect(notice()).toBe('');
  events.relayIssue?.(reason);
  expect(notice()).toBe('');
  events.mode('connecting');
  expect(notice()).not.toBe('');
  events.relayIssue?.(null);
  expect(notice()).toBe('');
  controller.stop();
});

it('keeps operation and authorization errors visible while relay notices recover', () => {
  const { controller, events, notice } = harness();
  events.error(CONNECTION_ERRORS.authorization);
  events.relayIssue?.('unavailable');
  events.mode('direct');
  events.relayIssue?.(null);
  expect(notice()).toBe(CONNECTION_ERRORS.authorization);
  expect(controller.snapshot().connectionIssue).toBe(CONNECTION_ERRORS.authorization);
  controller.stop();
});

it('does not show relay notices on an already working relay or clear the stored relay condition', () => {
  const { controller, events, notice } = harness();
  events.relayIssue?.('unavailable');
  events.mode('relay');
  expect(notice()).toBe('');
  expect(controller.snapshot().relayIssue).toBe('unavailable');
  controller.stop();
});
