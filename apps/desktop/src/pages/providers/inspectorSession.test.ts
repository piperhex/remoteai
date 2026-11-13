import { expect, it, vi } from 'vitest';
import { inspectorSession, type InspectorPlacement } from '../../../../../shared/browser/managed/inspectorSession';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const target = { id: 'tab', kind: 'provider' as const };
const placement: InspectorPlacement = { action: 'place', dock: 'right', visible: true,
  bounds: { x: 600, y: 150, width: 400, height: 500 } };

it('keeps geometry updates single-flight and applies the latest dock and bounds', async () => {
  let finish!: () => void;
  invoke.mockReset().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
    .mockResolvedValue(true);
  const session = inspectorSession(target, vi.fn());
  session.update(placement);
  session.update({ ...placement, bounds: { ...placement.bounds, width: 350 } });
  const latest = { ...placement, dock: 'bottom' as const, bounds: { x: 0, y: 500, width: 1000, height: 300 } };
  session.update(latest);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(invoke).toHaveBeenCalledTimes(1);
  finish();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke.mock.calls[1][1].request.command).toEqual(latest);
  await session.stop();
});

it('retires pending resizes before hiding and never revives a removed surface', async () => {
  let finish!: () => void;
  invoke.mockReset().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
    .mockResolvedValue(true);
  const session = inspectorSession(target, vi.fn());
  session.update(placement);
  session.update({ ...placement, dock: 'window' });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  const stopped = session.stop();
  session.update(placement);
  expect(invoke).toHaveBeenCalledTimes(1);
  finish(); await stopped;
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[1][1].request.command).toEqual({ ...placement, visible: false });
});

it('does not let an old surface hide an inspector remounted for the same tab', async () => {
  let finish!: () => void;
  invoke.mockReset().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
    .mockResolvedValue(true);
  const old = inspectorSession(target, vi.fn());
  old.update(placement);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  const stopped = old.stop();
  const current = inspectorSession(target, vi.fn());
  current.update({ ...placement, dock: 'bottom' });
  finish(); await stopped;
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke.mock.calls[1][1].request.command.visible).toBe(true);
  await current.stop();
});

it('reports placement failures while keeping a later retry usable', async () => {
  const error = vi.fn();
  invoke.mockReset().mockRejectedValueOnce(new Error('closed')).mockResolvedValue(true);
  const session = inspectorSession(target, error);
  session.update(placement);
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  session.update({ ...placement, dock: 'window' });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  await session.stop();
});
