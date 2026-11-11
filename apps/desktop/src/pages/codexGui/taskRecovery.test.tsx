// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTaskRecovery } from '../../../../../shared/conversation/recovery/useTaskRecovery';
import type { RecoveryClient, RecoverySnapshot } from '../../../../../shared/conversation/recovery/types';

const snapshot: RecoverySnapshot = { batchId: 'restart', candidates: [{ title: 'Task',
  entry: { threadId: 'thread', turnId: 'interrupted', observedAt: 1 } }] };
let host: HTMLDivElement;
let root: Root;
let state: ReturnType<typeof useTaskRecovery>;
let notify: Parameters<RecoveryClient['subscribe']>[0];
let client: RecoveryClient;
let unsubscribe: ReturnType<typeof vi.fn>;
function Harness({ enabled = true }: { enabled?: boolean }) {
  state = useTaskRecovery(client, enabled);
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  unsubscribe = vi.fn();
  client = { read: vi.fn().mockResolvedValue(snapshot), decide: vi.fn().mockResolvedValue({ failed: [] }),
    subscribe: listener => { notify = listener; return unsubscribe; } };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('waits for an active connection and removes a batch consumed by another client', async () => {
  await act(async () => root.render(<Harness enabled={false} />));
  expect(client.read).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness />));
  expect(state.snapshot?.candidates).toHaveLength(1);
  vi.mocked(client.read).mockResolvedValue({ ...snapshot, candidates: [] });
  await act(async () => notify({ method: 'recovery/changed', params: {} }));
  expect(state.snapshot?.candidates).toHaveLength(0);
  await act(async () => root.render(<Harness enabled={false} />));
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('coalesces changes while a read is pending instead of overlapping requests', async () => {
  let finish!: (value: RecoverySnapshot) => void;
  vi.mocked(client.read).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => {
    notify({ method: 'recovery/changed', params: {} });
    notify({ method: 'recovery/changed', params: {} });
  });
  expect(client.read).toHaveBeenCalledOnce();
  await act(async () => finish(snapshot));
  expect(client.read).toHaveBeenCalledTimes(2);
  expect(state.snapshot?.candidates).toHaveLength(1);
});

it('submits a repeated confirmation only once and exposes failed tasks', async () => {
  let finish!: (result: { failed: { threadId: string; title: string }[] }) => void;
  vi.mocked(client.decide).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => { void state.decide('resume'); void state.decide('resume'); });
  expect(client.decide).toHaveBeenCalledOnce();
  expect(client.decide).toHaveBeenCalledWith(snapshot, 'resume');
  expect(state.snapshot).toBeUndefined();
  const failed = [{ threadId: 'thread', title: 'Task' }];
  await act(async () => finish({ failed }));
  expect(state.failure?.failed).toEqual(failed);
});

it('keeps tasks paused when dismissed and does not retain state after disconnecting', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => state.decide('dismiss'));
  expect(client.decide).toHaveBeenCalledWith(snapshot, 'dismiss');
  expect(state.snapshot).toBeUndefined();
  await act(async () => root.render(<Harness enabled={false} />));
  expect(state.failure).toBeUndefined();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('does not restore a stopped task when the host journal is empty after restarting or reconnecting', async () => {
  vi.mocked(client.read).mockResolvedValue({ batchId: 'new-launch', candidates: [] });
  await act(async () => root.render(<Harness />));
  expect(state.snapshot?.candidates).toEqual([]);
  await act(async () => root.render(<Harness enabled={false} />));
  await act(async () => root.render(<Harness />));
  await act(async () => notify({ method: 'recovery/changed', params: {} }));
  expect(state.snapshot?.candidates).toEqual([]);
  expect(client.decide).not.toHaveBeenCalled();
});
