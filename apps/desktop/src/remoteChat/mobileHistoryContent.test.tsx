// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileHistoryContent } from '../../../../shared/remote-chat/views/MobileHistoryContent';
import { HistoryContent } from '../../../../shared/remote-chat/views/HistoryContent';
import { FileEnvironmentContext, type FileEnvironment } from '../../../../shared/conversation/fileEnvironment';
import { captureVirtualScroll } from '../../../../shared/chat/virtualScroll';

const observers = new Set<Observer>();
class Observer {
  targets = new Set<Element>();
  constructor(private callback: IntersectionObserverCallback) { observers.add(this); }
  observe = (target: Element) => this.targets.add(target);
  unobserve = (target: Element) => this.targets.delete(target);
  disconnect = () => { this.targets.clear(); observers.delete(this); };
  notify(target: Element, isIntersecting: boolean) {
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(observers.size).toBe(0);
  container.remove(); vi.unstubAllGlobals();
});
async function visible(target: Element, next: boolean) {
  await act(async () => {
    for (const observer of observers) if (observer.targets.has(target)) observer.notify(target, next);
  });
}

it('does not construct a loaded page until visible and releases heavy content without losing its height', async () => {
  const render = vi.fn(() => <p>Rich contents</p>);
  await act(async () => root.render(<>{Array.from({ length: 300 }, (_, i) =>
    <MobileHistoryContent key={i}>{render}</MobileHistoryContent>)}</>));
  expect(render).not.toHaveBeenCalled();
  expect(observers.size).toBe(1);
  const slots = container.querySelectorAll<HTMLElement>('[data-mobile-history-content]');
  slots[150].getBoundingClientRect = () => ({ height: 432, width: 390 }) as DOMRect;
  await visible(slots[150], true);
  expect(render).toHaveBeenCalledTimes(1);
  await visible(slots[150], false);
  expect(container.querySelectorAll('p')).toHaveLength(0);
  expect(slots[150].style.height).toBe('432px');
  await visible(slots[150], true);
  expect(render).toHaveBeenCalledTimes(2);
});

it('releases a focused row after focus leaves instead of retaining historical controls indefinitely', async () => {
  await act(async () => root.render(<MobileHistoryContent>{() => <button>Copy</button>}</MobileHistoryContent>));
  const slot = container.firstElementChild!;
  await visible(slot, true);
  container.querySelector('button')!.focus();
  await visible(slot, false);
  expect(container.querySelector('button')).not.toBeNull();
  await act(async () => { container.querySelector('button')!.blur(); });
  expect(container.querySelector('button')).toBeNull();
});

it('retains only the row that owns a dialog and releases it when that dialog closes', async () => {
  await act(async () => root.render(<>
    <MobileHistoryContent>{() => <dialog open>Image preview</dialog>}</MobileHistoryContent>
    <MobileHistoryContent>{() => <p>Another rich row</p>}</MobileHistoryContent>
  </>));
  const slots = container.querySelectorAll('[data-mobile-history-content]');
  await visible(slots[0], true); await visible(slots[1], true);
  await visible(slots[0], false); await visible(slots[1], false);
  expect(container.querySelector('dialog')).not.toBeNull();
  expect(container.querySelector('p')).toBeNull();
  await act(async () => root.render(<>
    <MobileHistoryContent>{() => null}</MobileHistoryContent>
    <MobileHistoryContent>{() => <p>Another rich row</p>}</MobileHistoryContent>
  </>));
  expect(slots[0].getAttribute('data-mobile-history-content')).toBe('placeholder');
});

it('windows mobile Web only, preserving wide Web and narrow embedded desktop remote content', async () => {
  const content = () => <p>Desktop content</p>;
  await act(async () => root.render(<HistoryContent desktop enabled>{content}</HistoryContent>));
  expect(container.querySelector('p')).not.toBeNull();
  expect(container.querySelector('[data-mobile-history-content]')).toBeNull();
  // This boundary only inspects the context's presence; no file operations are invoked by the fixture.
  const environment = { remote: true } as FileEnvironment;
  await act(async () => root.render(<FileEnvironmentContext.Provider value={environment}>
    <HistoryContent desktop={false} enabled={false}>{content}</HistoryContent>
  </FileEnvironmentContext.Provider>));
  expect(container.querySelector('p')).not.toBeNull();
  expect(container.querySelector('[data-mobile-history-content]')).toBeNull();
  await act(async () => root.render(<HistoryContent desktop={false} enabled={false}>{content}</HistoryContent>));
  expect(container.querySelector('p')).toBeNull();
  expect(container.querySelector('[data-mobile-history-content]')).not.toBeNull();
});

it('uses explicit following state instead of mistaking a temporarily clamped offset for reader intent', () => {
  expect(captureVirtualScroll(container)?.bottom).toBe(true);
  expect(captureVirtualScroll(container, false)?.bottom).toBe(false);
  Object.defineProperties(container, { scrollHeight: { value: 1_000 }, clientHeight: { value: 300 } });
  container.scrollTop = 650;
  expect(captureVirtualScroll(container)?.bottom).toBe(false);
  expect(captureVirtualScroll(container, true)?.bottom).toBe(true);
});
