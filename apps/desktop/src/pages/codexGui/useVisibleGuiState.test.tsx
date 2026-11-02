// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { GuiController } from './controller';
import { useVisibleGuiState } from './useVisibleGuiState';

it('pauses hidden rendering while the controller continues work and immediately catches up on return', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const controller = new GuiController();
  const container = document.createElement('div');
  const root = createRoot(container);
  const rendered = vi.fn();
  function View({ active }: { active: boolean }) {
    const { state } = useVisibleGuiState(controller, active);
    rendered(state); return <span>{state.error}</span>;
  }
  try {
    await act(async () => root.render(<View active />));
    await act(async () => controller.report('first'));
    expect(container.textContent).toBe('first');
    controller.getSnapshot().conversations.history = { thread: { id: 'history', cwd: '', preview: '', updatedAt: 1 },
      turns: [], activeTurn: null, error: '', tokens: 0 };
    const selected = controller.getSnapshot().conversations.history;
    controller.getSnapshot().selected = 'selected';
    controller.getSnapshot().conversations.selected = selected;
    await act(async () => root.render(<View active={false} />));
    expect(rendered.mock.lastCall?.[0].conversations).toEqual({ selected });
    rendered.mockClear();
    for (let index = 0; index < 100; index++) controller.report(`background ${index}`);
    expect(rendered).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toBe('background 99');
    await act(async () => root.render(<View active />));
    expect(container.textContent).toBe('background 99');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    rendered.mockClear();
    controller.report('still running');
    expect(rendered).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(container.textContent).toBe('still running');
  } finally {
    await act(async () => root.unmount()); controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
