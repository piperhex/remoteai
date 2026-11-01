// @vitest-environment jsdom
import { act, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useCommittedCallback } from '../../../../shared/chat/useCommittedCallback';

it('retains row callbacks while invoking only the latest committed action', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const renders = vi.fn();
  const Row = memo(({ open }: { open: () => void }) => {
    renders(); return <button onClick={open}>Open</button>;
  });
  const Fixture = ({ action }: { action: () => void }) => <Row open={useCommittedCallback(action)} />;
  const previous = vi.fn(); const current = vi.fn();
  try {
    await act(async () => root.render(<Fixture action={previous} />));
    await act(async () => root.render(<Fixture action={current} />));
    await act(async () => host.querySelector('button')!.click());
    expect(renders).toHaveBeenCalledTimes(1);
    expect(previous).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
