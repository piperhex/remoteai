// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageAnnotationsProvider, useComposerImageAnnotations } from '../../../../shared/chat/ImageAnnotations';
import { usePreviewImageAnnotation } from '../../../../shared/chat/usePreviewImageAnnotation';

const original = 'data:image/png;base64,b3JpZ2luYWw=';
const edited = 'data:image/png;base64,ZWRpdGVk';
let root: Root;
let annotation: ReturnType<typeof usePreviewImageAnnotation>;
let options: { scope: string; enabled: boolean; load: () => Promise<string> };
const add = vi.fn();
const focus = vi.fn();

function Preview() { annotation = usePreviewImageAnnotation(options.load); return null; }
function Harness() {
  useComposerImageAnnotations({ ...options, add, focus, mode: 'direct' });
  return <Preview />;
}
const render = () => act(async () => root.render(<ImageAnnotationsProvider><Harness /></ImageAnnotationsProvider>));

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 0; });
  add.mockReset(); focus.mockReset();
  root = createRoot(document.createElement('div'));
  options = { scope: 'first', enabled: true, load: vi.fn().mockResolvedValue(original) };
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('loads the original once, adds only the finished image, and cancels without adding anything', async () => {
  await act(async () => { await annotation.open(); });
  expect(annotation.editing?.source).toBe(original);
  expect(add).not.toHaveBeenCalled();
  await act(async () => annotation.cancel());
  expect(annotation.editing).toBeNull();
  expect(add).not.toHaveBeenCalled();
  await act(async () => { await annotation.open(); });
  await act(async () => annotation.save(edited));
  expect(add).toHaveBeenCalledExactlyOnceWith(edited);
  expect(focus).toHaveBeenCalledOnce();
});

it('prevents overlapping loads and never opens the editor in a different conversation', async () => {
  let finish!: (url: string) => void;
  options.load = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  await render();
  let pending!: Promise<void>;
  await act(async () => { pending = annotation.open(); void annotation.open(); });
  expect(options.load).toHaveBeenCalledOnce();
  options.scope = 'second';
  await render();
  await act(async () => { finish(original); await pending; });
  expect(annotation.editing).toBeNull();
  expect(add).not.toHaveBeenCalled();
});

it('rejects saves after switching or disabling the composer and keeps annotations on an add failure', async () => {
  await act(async () => { await annotation.open(); });
  options.scope = 'second';
  await render();
  expect(() => annotation.save(edited)).toThrow();
  options.scope = 'first'; options.enabled = false;
  await render();
  expect(() => annotation.save(edited)).toThrow();
  expect(add).not.toHaveBeenCalled();
  options.enabled = true;
  await render();
  add.mockImplementationOnce(() => { throw new Error('Image limit'); });
  expect(() => annotation.save(edited)).toThrow('Image limit');
  expect(annotation.editing?.source).toBe(original);
  expect(focus).not.toHaveBeenCalled();
});

it('allows retry after a failed original load and ignores a load after the preview unmounts', async () => {
  options.load = vi.fn().mockRejectedValueOnce(new Error('private path')).mockResolvedValue(original);
  await render();
  await act(async () => { await annotation.open(); });
  expect(annotation.failed).toBe(true);
  expect(annotation.editing).toBeNull();
  await act(async () => { await annotation.open(); });
  expect(annotation.failed).toBe(false);
  expect(annotation.editing?.source).toBe(original);
  let finish!: (url: string) => void;
  options.load = () => new Promise(resolve => { finish = resolve; });
  await render();
  let pending!: Promise<void>;
  await act(async () => { pending = annotation.open(); });
  await act(async () => root.render(null));
  await act(async () => { finish(original); await pending; });
  expect(add).not.toHaveBeenCalled();
});
