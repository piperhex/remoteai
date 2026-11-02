// @vitest-environment jsdom
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../../../../shared/chat/ImageViewer';

let host: HTMLDivElement;
let root: Root;
let stage: HTMLDivElement;
let image: HTMLImageElement;
let frames: Map<number, FrameRequestCallback>;
let captures: Set<number>;
const rendered = vi.fn();
const source = 'data:image/png;base64,cHJldmlldw==';
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  frames = new Map();
  captures = new Set();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value(this: HTMLDialogElement) { this.open = true; },
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Profiler id="viewer" onRender={rendered}>
    <ImageViewer thumbnail={source} description="preview" load={async () => source} close={() => {}} />
  </Profiler>));
  stage = host.querySelector('.cs-image-stage')!;
  image = stage.querySelector('img')!;
  stage.setPointerCapture = vi.fn(id => { captures.add(id); });
  stage.hasPointerCapture = id => captures.has(id);
  stage.releasePointerCapture = vi.fn(id => { captures.delete(id); });
  rendered.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
});

function pointer(type: string, options: Partial<PointerEventInit> = {}) {
  // jsdom does not provide PointerEvent; add its identity to a cancelable mouse event.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...options });
  Object.defineProperty(event, 'pointerId', { value: options.pointerId ?? 1 });
  stage.dispatchEvent(event);
  return event;
}

async function paint() {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
}

it('prevents native dragging without intercepting right clicks', async () => {
  await act(async () => {
    expect(pointer('pointerdown', { button: 2 }).defaultPrevented).toBe(false);
    expect(stage.setPointerCapture).not.toHaveBeenCalled();
    expect(pointer('pointerdown').defaultPrevented).toBe(true);
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    stage.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);
  });
});

it('follows a long drag across frames without rerendering the viewer', async () => {
  await act(async () => {
    pointer('pointerdown', { clientX: 100, clientY: 100 });
    for (let step = 1; step <= 100; step++) {
      pointer('pointermove', { clientX: 100 + step * 3, clientY: 100 + step * 2 });
    }
  });
  expect(frames.size).toBe(1);
  await paint();
  expect(image.style.transform).toBe('translate(300px, 200px) rotate(0deg) scale(1)');
  await act(async () => { pointer('pointermove', { clientX: 700, clientY: 500 }); });
  await paint();
  expect(image.style.transform).toContain('translate(600px, 400px)');
  expect(rendered).not.toHaveBeenCalled();
});

it('keeps the release position when another drag starts before the next frame', async () => {
  await act(async () => {
    pointer('pointerdown', { clientX: 20, clientY: 30 });
    pointer('pointermove', { clientX: 70, clientY: 90 });
    pointer('pointerup', { clientX: 100, clientY: 110 });
    pointer('pointerdown', { clientX: 200, clientY: 200 });
    pointer('pointermove', { clientX: 300, clientY: 250 });
    pointer('pointerup', { clientX: 320, clientY: 260 });
  });
  expect(image.style.transform).toBe('translate(200px, 140px) rotate(0deg) scale(1)');
  expect(frames.size).toBe(0);
  expect(captures.size).toBe(0);
});

it('rebases pinch and remaining-finger panning from the latest position before painting', async () => {
  await act(async () => {
    pointer('pointerdown', { clientX: 100, clientY: 100 });
    pointer('pointermove', { clientX: 150, clientY: 100 });
    pointer('pointerdown', { pointerId: 2, clientX: 250, clientY: 100 });
    pointer('pointermove', { pointerId: 2, clientX: 350, clientY: 100 });
    pointer('pointerup', { pointerId: 2, clientX: 350, clientY: 100 });
    pointer('pointermove', { clientX: 200, clientY: 120 });
  });
  await paint();
  expect(image.style.transform).toBe('translate(150px, 20px) rotate(0deg) scale(2)');
  expect(host.querySelector('.cs-image-toolbar')?.textContent).toContain('200%');
});

it.each(['pointercancel', 'lostpointercapture'])('ends %s without ghost dragging and allows a new drag', async type => {
  await act(async () => {
    pointer('pointerdown', { clientX: 100, clientY: 100 });
    pointer('pointermove', { clientX: 150, clientY: 160 });
    pointer(type);
    pointer('pointermove', { clientX: 800, clientY: 700 });
  });
  expect(image.style.transform).toContain('translate(50px, 60px)');
  expect(frames.size).toBe(0);
  await act(async () => {
    pointer('pointerdown', { clientX: 200, clientY: 200 });
    pointer('pointermove', { clientX: 300, clientY: 300 });
  });
  await paint();
  expect(image.style.transform).toContain('translate(150px, 160px)');
});

it('preserves panning through wheel zoom and resets pending movement', async () => {
  await act(async () => {
    pointer('pointerdown', { clientX: 100, clientY: 100 });
    pointer('pointermove', { clientX: 150, clientY: 150 });
    stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
    pointer('pointermove', { clientX: 200, clientY: 200 });
  });
  await paint();
  expect(image.style.transform).toBe('translate(100px, 100px) rotate(0deg) scale(1.2)');
  await act(async () => {
    pointer('pointermove', { clientX: 250, clientY: 250 });
    host.querySelectorAll<HTMLButtonElement>('.cs-image-toolbar button')[1].click();
  });
  expect(frames.size).toBe(0);
  expect(image.style.transform).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
});

it('cancels queued painting when the preview closes', async () => {
  await act(async () => {
    pointer('pointerdown');
    pointer('pointermove', { clientX: 100 });
  });
  expect(frames.size).toBe(1);
  await act(async () => root.render(null));
  expect(frames.size).toBe(0);
});

it('keeps wheel zoom out of conversation scrolling and coalesces a burst into one paint', async () => {
  const backgroundWheel = vi.fn();
  host.addEventListener('wheel', backgroundWheel);
  const mutations = vi.fn();
  const observer = new MutationObserver(mutations);
  observer.observe(image, { attributes: true, attributeFilter: ['style'] });
  await act(async () => {
    for (const deltaY of [-100, -100, 100, 100, 100]) {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY });
      stage.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });
  expect(backgroundWheel).not.toHaveBeenCalled();
  expect(mutations).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  await paint();
  expect(mutations).toHaveBeenCalledOnce();
  expect(host.querySelector('.cs-image-toolbar')?.textContent).toContain('83%');
  observer.disconnect();
});

it('does not treat horizontal wheel input as zooming out', async () => {
  await act(async () => {
    stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 100 }));
  });
  await paint();
  expect(image.style.transform).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
});

it.each(['wheel', 'buttons'])('keeps long drags smooth after zooming in then out with %s', async method => {
  const zoom = async (direction: 'in' | 'out') => {
    await act(async () => {
      if (method === 'wheel') {
        stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: direction === 'in' ? -100 : 100 }));
      } else {
        host.querySelectorAll<HTMLButtonElement>('.cs-image-toolbar button')[direction === 'in' ? 2 : 0].click();
      }
    });
    await paint();
  };
  for (let step = 0; step < 5; step++) await zoom('in');
  for (let step = 0; step < 7; step++) await zoom('out');
  expect(host.querySelector('.cs-image-toolbar')?.textContent).toContain(method === 'wheel' ? '69%' : '50%');
  rendered.mockClear();
  await act(async () => { pointer('pointerdown', { clientX: 100, clientY: 100 }); });
  for (let step = 1; step <= 10; step++) {
    await act(async () => { pointer('pointermove', { clientX: 100 + step * 50, clientY: 100 + step * 20 }); });
    await paint();
    expect(image.style.transform).toContain(`translate(${step * 50}px, ${step * 20}px)`);
  }
  expect(rendered).not.toHaveBeenCalled();
});
