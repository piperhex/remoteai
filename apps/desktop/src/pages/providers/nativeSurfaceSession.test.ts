import { expect, it, vi } from 'vitest';
import { nativeSurfaceSession } from '../../../../../shared/browser/managed/nativeSurfaceSession';

const visible = { visible: true };
const covered = { visible: false, preservePreview: true };
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function fixture() {
  const events: string[] = [];
  const apply = vi.fn(async (request: { visible: boolean }) => { events.push(request.visible ? 'show' : 'hide'); });
  const capture = vi.fn(async () => { events.push('capture'); return 'page-image'; });
  const preview = vi.fn(async (image: string | null) => { events.push(image ? 'preview' : 'clear'); });
  const failed = vi.fn();
  return { events, apply, capture, preview, failed,
    session: nativeSurfaceSession({ apply, capture, preview, failed }) };
}

it('paints the captured page before hiding it and restores the same native view before clearing', async () => {
  const { session, events, capture } = fixture();
  session.update(visible); await settle();
  events.length = 0;
  session.update(covered); await settle();
  expect(events).toEqual(['capture', 'preview', 'hide']);
  session.update(covered); await settle();
  expect(capture).toHaveBeenCalledTimes(1);
  events.length = 0;
  session.update(visible); await settle();
  expect(events).toEqual(['show', 'clear']);
  await session.close();
});

it('does not capture when switching away from a tab or hiding an unopened view', async () => {
  const { session, capture, preview } = fixture();
  session.update(covered); await settle();
  session.update(visible); await settle();
  session.update({ visible: false }); await settle();
  expect(capture).not.toHaveBeenCalled();
  expect(preview).toHaveBeenLastCalledWith(null, expect.any(Function));
  await session.close();
});

it('ignores a late capture when the menu closes or the session is disposed', async () => {
  for (const dispose of [false, true]) {
    const { session, capture, preview, apply } = fixture();
    session.update(visible); await settle();
    let finish!: (image: string) => void;
    capture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    session.update(covered); await settle();
    const closing = dispose ? session.close() : undefined;
    if (!dispose) session.update(visible);
    finish('late-image'); await closing; await settle();
    expect(preview.mock.calls.some(([image]) => image === 'late-image')).toBe(false);
    expect(apply.mock.calls.some(([request]) => !request.visible)).toBe(false);
    await session.close();
  }
});

it('coalesces duplicate overlay observations while capture is pending', async () => {
  const { session, capture, events } = fixture();
  session.update(visible); await settle();
  let finish!: (image: string) => void;
  capture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  session.update(covered); await settle();
  session.update(covered);
  finish('page-image'); await settle();
  expect(capture).toHaveBeenCalledTimes(1);
  expect(events.indexOf('preview')).toBeLessThan(events.indexOf('hide'));
  await session.close();
});

it('keeps placement usable after capture failure and reports placement failures', async () => {
  const { session, capture, apply, failed } = fixture();
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  session.update(visible); await settle();
  capture.mockRejectedValueOnce(new Error('capture unavailable'));
  session.update(covered); await settle();
  expect(apply).toHaveBeenLastCalledWith(covered);
  expect(failed).not.toHaveBeenCalled();
  apply.mockRejectedValueOnce(new Error('placement unavailable'));
  session.update(visible); await settle();
  expect(failed).toHaveBeenCalledOnce();
  await session.close(); debug.mockRestore();
});
