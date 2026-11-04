import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteGoals } from '../../../../shared/remote-chat/client/goals';
import { applyChatEvent } from '../../../../shared/remote-chat/client/events';
import { initialChatState, type ChatState, type Request } from '../../../../shared/remote-chat/client/types';
import type { ThreadGoal } from '../../../../shared/conversation/goalTypes';
import { testModels } from '../../../../shared/conversation/testing/models';

const thread = { id: 'one', cwd: 'F:/project', preview: '', updatedAt: 1, turns: [] };
const goal: ThreadGoal = { threadId: thread.id, objective: '完成登录页面', status: 'active', tokenBudget: null,
  tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 };
const input = { text: goal.objective, access: 'workspace-write' as const, goalMode: true };
let state: ChatState;
let goals: RemoteGoals;
let generation: number;
const request = vi.fn<(body: Request) => Promise<unknown>>();
const created = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); generation = 0;
  state = { ...initialChatState(), ready: true, draftProject: { cwd: thread.cwd, label: 'project' },
    models: [{ ...testModels[0], id: 'astra', model: 'astra' }] };
  request.mockImplementation(async (body) => {
    if (body.operation === 'resume') return {};
    if (body.operation === 'goalGet' || body.operation === 'goalSet') return { goal };
    return { thread };
  });
  goals = new RemoteGoals({ snapshot: () => state, update: (patch) => { state = { ...state, ...patch }; },
    request: async <T,>(body: Request) => await request(body) as T, created, generation: () => generation });
});

it('creates the goal in the chosen project and preserves selected model settings', async () => {
  expect(await goals.start({ ...input, model: 'astra', effort: 'high' })).toBe(true);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'start', cwd: thread.cwd, model: 'astra' }));
  expect(created).toHaveBeenCalledWith(thread.id, expect.objectContaining({ model: 'astra', effort: 'high' }));
  expect(state.goals?.one).toEqual(goal);
  expect(state.selected?.id).toBe(thread.id);
  expect(request.mock.calls.map(([body]) => body.operation)).toEqual(['start', 'goalSet']);
});

it('resumes existing conversations and reads their current activity before setting a goal', async () => {
  state.selected = thread;
  expect(await goals.start(input)).toBe(true);
  expect(request.mock.calls.map(([body]) => body.operation)).toEqual(['resume', 'read', 'goalSet']);
});

it('preserves newer goal events over a late acknowledgement and synchronizes removal', async () => {
  request.mockImplementation(async (body) => {
    if (body.operation === 'goalSet') {
      state = applyChatEvent(state, { method: 'thread/goal/updated', params: { threadId: thread.id,
        goal: { ...goal, status: 'complete' } } });
      return { goal };
    }
    return { thread };
  });
  await goals.start(input);
  expect(state.goals?.one?.status).toBe('complete');
  expect(await goals.clear(thread.id)).toBe(true);
  expect(state.goals?.one).toBeNull();
});

it('keeps the goal when removal fails and rejects pending messages or a newly started PC turn', async () => {
  state.selected = thread; state.goals = { one: goal };
  request.mockRejectedValueOnce(new Error('offline'));
  expect(await goals.clear(thread.id)).toBe(false);
  expect(state.goals.one).toEqual(goal);
  state.queue.threads.one = [{ id: 'queued', text: 'next', imageCount: 0, attachmentCount: 0, busy: false }];
  expect(await goals.start(input)).toBe(false);
  state.queue.threads.one = [];
  request.mockImplementation(async (body) => body.operation === 'resume' ? {} : {
    thread: { ...thread, turns: [{ id: 'turn', status: 'inProgress', items: [] }] },
  });
  expect(await goals.start(input)).toBe(false);
  expect(request.mock.calls.some(([body]) => body.operation === 'goalSet')).toBe(false);
});

it('does not overwrite a different connection after an interrupted first goal', async () => {
  request.mockImplementationOnce(async () => { generation++; return { thread }; });
  expect(await goals.start(input)).toBe(false);
  expect(state.selected).toBeNull();
  expect(state.goalBusy).toBe(false);
});

it('allows removing an active goal while its current turn is still running', async () => {
  state.selected = { ...thread, turns: [{ id: 'turn', status: 'inProgress', items: [] }] };
  state.goals = { one: goal };
  expect(await goals.clear(thread.id)).toBe(true);
  expect(state.goals.one).toBeNull();
  expect(state.selected.turns?.[0].status).toBe('inProgress');
});
