// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useFollowScroll } from './useFollowScroll';

it('preserves a reader position on return and follows a newly selected conversation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const scrollTo = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(5000);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  const container = document.createElement('div');
  const root = createRoot(container);
  let latest: ReturnType<typeof useFollowScroll>;
  function View({ active, selected }: { active: boolean; selected: string }) {
    latest = useFollowScroll(selected, active);
    return <div ref={latest.viewport}><div ref={latest.content} /></div>;
  }
  const render = (active: boolean, selected = 'first') => act(async () => root.render(
    <View active={active} selected={selected} />,
  ));
  try {
    await render(true);
    await act(async () => latest.pauseFollowing());
    const viewport = container.firstElementChild!;
    viewport.scrollTop = 300;
    scrollTo.mockClear();
    await render(false);
    await render(true);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(300);
    await render(true, 'second');
    expect(scrollTo).toHaveBeenCalledWith({ top: 5000 });
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
