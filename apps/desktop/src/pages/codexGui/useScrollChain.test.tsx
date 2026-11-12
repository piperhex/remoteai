// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useScrollChain } from '../../../../../shared/chat/useScrollChain';

let host: HTMLDivElement;
let root: Root;
function Harness() {
  const list = useScrollChain<HTMLDivElement>();
  const output = useScrollChain<HTMLDivElement>();
  return <div data-history style={{ overflowY: 'auto', overscrollBehaviorY: 'none' }}>
    <div ref={list} data-list style={{ overflowY: 'auto', lineHeight: '20px' }}>
      <div ref={output} data-output style={{ overflowY: 'auto', lineHeight: '20px' }}><span>Output</span></div>
    </div>
  </div>;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
  for (const node of host.querySelectorAll('[data-history], [data-list], [data-output]')) {
    Object.defineProperties(node, { scrollHeight: { value: 600 }, clientHeight: { value: 200 } });
  }
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function nodes() {
  return { history: host.querySelector<HTMLElement>('[data-history]')!,
    list: host.querySelector<HTMLElement>('[data-list]')!, output: host.querySelector<HTMLElement>('[data-output]')! };
}
function wheel(options: WheelEventInit) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
  host.querySelector('span')!.dispatchEvent(event);
  return event;
}

it('consumes one downward delta across output, activity and history without double scrolling', () => {
  const { history, list, output } = nodes();
  output.scrollTop = 300; list.scrollTop = 200; history.scrollTop = 50;
  expect(wheel({ deltaY: 450 }).defaultPrevented).toBe(true);
  expect([output.scrollTop, list.scrollTop, history.scrollTop]).toEqual([400, 400, 200]);
});

it('continues upward through each boundary and leaves exhausted gestures available to history loading', () => {
  const { history, list, output } = nodes();
  output.scrollTop = 40; list.scrollTop = 60; history.scrollTop = 100;
  expect(wheel({ deltaY: -150 }).defaultPrevented).toBe(true);
  expect([output.scrollTop, list.scrollTop, history.scrollTop]).toEqual([0, 0, 50]);
  wheel({ deltaY: -50 });
  expect(wheel({ deltaY: -120 }).defaultPrevented).toBe(false);
});

it('honors containing scroll surfaces without moving their parents', () => {
  const { history, list, output } = nodes();
  list.style.overscrollBehaviorY = 'contain';
  wheel({ deltaY: 1000 });
  expect([output.scrollTop, list.scrollTop, history.scrollTop]).toEqual([400, 400, 0]);
});

it.each([{ deltaY: 60, ctrlKey: true }, { deltaY: 60, metaKey: true }, { deltaY: 60, shiftKey: true },
  { deltaY: 60, deltaX: 120 }, { deltaY: 0, deltaX: 120 }])('preserves zoom and horizontal input: %j', options => {
  expect(wheel(options).defaultPrevented).toBe(false);
  expect(nodes().output.scrollTop).toBe(0);
});

it.each([{ deltaMode: 1, deltaY: 3, expected: 60 }, { deltaMode: 2, deltaY: 1, expected: 200 }])(
  'supports line and page wheel units: %j', ({ expected, ...options }) => {
    wheel(options); expect(nodes().output.scrollTop).toBe(expected);
  });
