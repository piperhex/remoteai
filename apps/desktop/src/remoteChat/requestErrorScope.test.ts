import { expect, it } from 'vitest';
import { applyChatEvent } from '../../../../shared/remote-chat/client/events';
import { initialChatState, type Thread } from '../../../../shared/remote-chat/client/types';
import { visibleTurnRequestErrors } from '../../../../shared/conversation/turnRequestErrors';

const thread: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'inProgress', items: [] }] };
const error = { message: 'unexpected status 502 Bad Gateway, url: http://127.0.0.1:51524/responses',
  additionalDetails: 'upstream connection closed' };
const failure = { method: 'error', params: { threadId: 'chat', turnId: 'turn', error, willRetry: false } };

it('keeps a final request failure inside its reply without a page error', () => {
  const state = applyChatEvent({ ...initialChatState(), selected: thread }, failure);
  expect(state.error).toBe('');
  expect(state.selected?.turns?.[0].error).toEqual(error);
  expect(visibleTurnRequestErrors(state.selected!.turns![0])).toMatchObject([
    { willRetry: false, error },
  ]);
});

it.each([null, { ...thread, id: 'another' }])('keeps a late failure out of a new or different chat (%j)', selected => {
  const state = { ...initialChatState(), selected };
  const result = applyChatEvent(state, failure);
  expect(result.error).toBe('');
  expect(result.selected).toBe(selected);
});

it('preserves actual connection errors when an unrelated reply fails', () => {
  const state = { ...initialChatState(), error: 'Connection unavailable' };
  expect(applyChatEvent(state, failure).error).toBe(state.error);
});

it('handles retries without a turn ID and removes their notice after recovery', () => {
  let state = applyChatEvent({ ...initialChatState(), selected: thread }, {
    method: 'error', params: { threadId: 'chat', error, willRetry: true },
  });
  expect(visibleTurnRequestErrors(state.selected!.turns![0])).toHaveLength(1);
  state = applyChatEvent(state, { method: 'turn/completed', params: {
    threadId: 'chat', turn: { id: 'turn', status: 'completed', items: [] },
  } });
  expect(state.error).toBe('');
  expect(visibleTurnRequestErrors(state.selected!.turns![0])).toEqual([]);
  expect(state.selected?.turns?.[0].requestErrors?.[0].error).toEqual(error);
});
