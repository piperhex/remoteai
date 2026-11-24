import { expect, it, vi } from 'vitest';
import { inspectorSession, type InspectorPlacement } from '../../../../../shared/browser/managed/inspectorSession';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const target = { id: 'tab', kind: 'provider' as const };
const opened = { open: true, mobile: false };
const closed = { open: false, mobile: false };
const placement: InspectorPlacement = { action: 'place', dock: 'right', visible: true,
  bounds: { x: 600, y: 150, width: 400, height: 500 } };

it('keeps geometry updates single-flight and applies the latest dock and bounds', async () => {
  let finish!: () => void;
  invoke.mockReset().mockImplementationOnce(() => new Promise<typeof opened>(resolve => { finish = () => resolve(opened); }))
    .mockResolvedValue(opened);
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
  invoke.mockReset().mockImplementationOnce(() => new Promise<typeof opened>(resolve => { finish = () => resolve(opened); }))
    .mockResolvedValue(opened);
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
  invoke.mockReset().mockImplementationOnce(() => new Promise<typeof opened>(resolve => { finish = () => resolve(opened); }))
    .mockResolvedValue(opened);
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
  invoke.mockReset().mockRejectedValueOnce(new Error('closed')).mockResolvedValue(opened);
  const session = inspectorSession(target, error);
  session.update(placement);
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  session.update(placement);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  await session.stop();
});

it('skips identical placements after success and while the same placement is in flight', async () => {
  let finish!: () => void;
  invoke.mockReset().mockImplementationOnce(() => new Promise<typeof opened>(resolve => { finish = () => resolve(opened); }))
    .mockResolvedValue(opened);
  const session = inspectorSession(target, vi.fn());
  session.update(placement);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  for (let index = 0; index < 100; index++) session.update({ ...placement, bounds: { ...placement.bounds } });
  finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(invoke).toHaveBeenCalledOnce();
  session.update({ ...placement, bounds: { ...placement.bounds } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(invoke).toHaveBeenCalledOnce();
  await session.stop();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[1][1].request.command.visible).toBe(false);
});

it.each([
  { ...placement, dock: 'bottom' as const },
  { ...placement, dock: 'window' as const },
  { ...placement, visible: false },
  { ...placement, viewport: { width: 393, height: 852, scale: 0.75 } },
  ...(['x', 'y', 'width', 'height'] as const).map(key => ({ ...placement,
    bounds: { ...placement.bounds, [key]: placement.bounds[key] + 1 } })),
])('applies changed placement %j', async changed => {
  invoke.mockReset().mockResolvedValue(opened);
  const session = inspectorSession(target, vi.fn());
  session.update(placement);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  session.update(changed);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke.mock.calls[1][1].request.command).toEqual(changed);
  await session.stop();
});

it('updates emulated dimensions even when the displayed page bounds stay the same', async () => {
  invoke.mockReset().mockResolvedValue(opened);
  const session = inspectorSession(target, vi.fn());
  const place = (width: number, height: number, scale: number) =>
    session.update({ ...placement, viewport: { width, height, scale } });
  place(393, 852, 1);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  place(786, 1704, 0.5);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  place(786, 1704, 0.5);
  await session.stop();
  expect(invoke).toHaveBeenCalledTimes(3);
  expect(invoke.mock.calls[2][1].request.command.visible).toBe(false);
});

it('restores a previous position after a different in-flight placement completes', async () => {
  let finish!: () => void;
  invoke.mockReset().mockResolvedValueOnce(opened)
    .mockImplementationOnce(() => new Promise<typeof opened>(resolve => { finish = () => resolve(opened); }))
    .mockResolvedValue(opened);
  const session = inspectorSession(target, vi.fn());
  session.update(placement);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  session.update({ ...placement, bounds: { ...placement.bounds, width: 350 } });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  session.update(placement);
  finish();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
  expect(invoke.mock.calls[2][1].request.command).toEqual(placement);
  await session.stop();
});

it('does not cache a placement when the native inspector is unavailable', async () => {
  invoke.mockReset().mockResolvedValueOnce(closed).mockResolvedValue(opened);
  const session = inspectorSession(target, vi.fn());
  session.update(placement);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  session.update(placement);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  await session.stop();
});

it('invalidates the previous placement after a failed move', async () => {
  const error = vi.fn();
  invoke.mockReset().mockResolvedValueOnce(opened).mockRejectedValueOnce(new Error('move failed'))
    .mockResolvedValue(opened);
  const session = inspectorSession(target, error);
  session.update(placement);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  session.update({ ...placement, dock: 'bottom' });
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  session.update(placement);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
  await session.stop();
});

it('does not hide an already hidden inspector again on cleanup', async () => {
  invoke.mockReset().mockResolvedValue(opened);
  const session = inspectorSession(target, vi.fn());
  session.update({ ...placement, visible: false });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  await session.stop();
  expect(invoke).toHaveBeenCalledOnce();
});

it('reapplies unchanged CSS bounds when moving to a monitor with a different scale', async () => {
  invoke.mockReset().mockResolvedValue(opened);
  const session = inspectorSession(target, vi.fn());
  session.update(placement, 1);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  session.update(placement, 1.5);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke.mock.calls[1][1].request.command).toEqual(placement);
  session.update(placement, 1.5);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(invoke).toHaveBeenCalledTimes(2);
  await session.stop();
});
