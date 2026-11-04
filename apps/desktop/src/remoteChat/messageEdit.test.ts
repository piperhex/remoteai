// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteMessageEditor, canEditRemoteMessage } from '../../../../shared/remote-chat/client/messageEdit';
import { initialChatState, type ChatState, type Thread } from '../../../../shared/remote-chat/client/types';
import type { MessageChangeResult } from '../../../../shared/conversation/editMessage';

const source: Thread = { id: 'thread', cwd: '', preview: '', updatedAt: 1, turns: [
  { id: 'first', status: 'completed', items: [{ id: 'old', type: 'userMessage',
    content: [{ type: 'text', text: 'keep' }] }] },
  { id: 'last', status: 'completed', items: [{ id: 'user', type: 'userMessage',
    content: [{ type: 'text', text: 'original' }] }, { id: 'reply', type: 'agentMessage', text: 'remove' }] },
] };
const retained = { ...source, turns: [source.turns![0]] };
const target = { threadId: 'thread', turnId: 'last', itemId: 'user' };
const request = vi.fn<(body: unknown) => Promise<MessageChangeResult>>();
const invalidate = vi.fn();
let state: ChatState;
let editor: RemoteMessageEditor;
beforeEach(() => {
  vi.resetAllMocks();
  state = { ...initialChatState(), ready: true, mode: 'direct', selected: structuredClone(source) };
  request.mockResolvedValue({ thread: retained });
  editor = new RemoteMessageEditor({ snapshot: () => state, update: patch => { state = { ...state, ...patch }; },
    request, invalidate, image: async () => 'data:image/png;base64,cGl4ZWw=' });
});

it('deletes the suffix, invalidates history and keeps the original conversation selected', async () => {
  expect(await editor.remove(target)).toBe(true);
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'deleteMessage', ...target, access: state.settings.access });
  expect(state.selected?.turns?.map(turn => turn.id)).toEqual(['first']);
  expect(state.selected?.id).toBe('thread');
  expect(state.sending).toBe(false);
  expect(invalidate).toHaveBeenCalledWith('thread');
});

it('preserves streamed replacement replies without resurrecting modified old turns', async () => {
  const turn = { id: 'replacement', status: 'inProgress', items: [] };
  request.mockImplementation(async () => {
    state = { ...state, selected: { ...source, turns: [source.turns![0], { ...source.turns![1] },
      { ...turn, status: 'completed', items: [{ id: 'new-reply', type: 'agentMessage', text: 'new reply' }] }] } };
    return { thread: retained, turn };
  });
  expect(await editor.submit({ ...target, text: 'edited', removedImageIndexes: [0] })).toBe(true);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'editMessage', text: 'edited',
    removedImageIndexes: [0] }));
  expect(state.selected?.turns?.map(turn => turn.id)).toEqual(['first', 'replacement']);
  expect(state.selected?.turns?.at(-1)).toMatchObject({ status: 'completed', items: [{ text: 'new reply' }] });
});

it('recovers the edit when rewind succeeds but resending fails', async () => {
  request.mockResolvedValue({ thread: retained, error: 'timeout' });
  expect(await editor.submit({ ...target, text: 'recover this' })).toBe(false);
  expect(state.selected?.turns?.map(turn => turn.id)).toEqual(['first']);
  expect(editor.recoveredDrafts.get('thread')?.text).toBe('recover this');
  expect(state.error).toContain('已放回输入框');
});

it('retains history on failure and rejects stale targets and duplicate deletions', async () => {
  expect(await editor.remove({ ...target, itemId: 'old' })).toBe(false);
  expect(request).not.toHaveBeenCalled();
  let fail!: (error: Error) => void;
  request.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  const before = state.selected;
  const deleting = editor.remove(target);
  expect(await editor.remove(target)).toBe(false);
  fail(new Error('cannot delete'));
  expect(await deleting).toBe(false);
  expect(state.selected).toBe(before);
  expect(state).toMatchObject({ sending: false, error: 'cannot delete' });
});

it.each<Partial<ChatState>>([
  { ready: false }, { sending: true }, { workspaceBusy: true }, { settingsBusy: true },
  { selectedArchived: true }, { historyOffline: true }, { compacting: 'thread' },
  { queue: { revision: 1, threads: { thread: [{ id: 'queued' } as never] } } },
  { selected: { ...source, status: { type: 'active' } } },
])('blocks editing during unavailable states: %j', patch => {
  expect(canEditRemoteMessage({ ...state, ...patch })).toBe(false);
});
