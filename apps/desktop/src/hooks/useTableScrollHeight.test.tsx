// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RetainedView } from '../../../../shared/RetainedView';
import { useTableScrollHeight } from './useTableScrollHeight';

it('retains the page, ignores hidden parent updates and keeps the last measured table height', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const resize = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize.mockImplementation(callback); }
    observe() {} disconnect() {}
  });
  let height = 600;
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  const mounted = vi.fn(); const disposed = vi.fn(); const rendered = vi.fn();
  function Table({ active, label }: { active: boolean; label: string }) {
    const { tableWrapRef, tableScrollY } = useTableScrollHeight('.toolbar', active);
    useEffect(() => { mounted(); return disposed; }, []);
    rendered(label);
    return <div ref={tableWrapRef} data-height={tableScrollY}>{label}</div>;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (active: boolean, label = 'initial', scope = 'first') => act(async () => root.render(
    <RetainedView active={active} scope={scope}><Table active={active} label={label} /></RetainedView>,
  ));
  try {
    await render(false);
    expect(mounted).not.toHaveBeenCalled();
    await render(true);
    expect(container.firstElementChild?.getAttribute('data-height')).toBe('600');
    const node = container.firstElementChild;
    height = 0;
    await render(false);
    await act(async () => resize());
    rendered.mockClear();
    await render(false, 'latest');
    expect(rendered).not.toHaveBeenCalled();
    expect(container.firstElementChild?.getAttribute('data-height')).toBe('600');
    await render(false, 'new identity', 'second');
    expect(container.textContent).toBe('new identity');
    height = 800;
    await render(true, 'latest');
    expect(container.firstElementChild).toBe(node);
    expect(container.textContent).toBe('latest');
    expect(node?.getAttribute('data-height')).toBe('800');
    expect(mounted).toHaveBeenCalledOnce();
    expect(disposed).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
