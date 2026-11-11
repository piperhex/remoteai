// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { copyLoungeImage } from '../../../../shared/lounge/clipboard';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
const source = 'data:image/png;base64,iVBORw0KGgo=';

beforeEach(() => { vi.clearAllMocks(); vi.mocked(isTauri).mockReturnValue(true); });
afterEach(() => { vi.unstubAllGlobals(); });

it('copies the selected original with the local native command in either desktop mode', async () => {
  vi.mocked(invoke).mockResolvedValue({ completed: true });
  await copyLoungeImage(source);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('codex_gui_image_action', {
    request: { source, action: 'copy' },
  });
});

it('does not report an incomplete native copy as successful', async () => {
  vi.mocked(invoke).mockResolvedValue({ completed: false });
  await expect(copyLoungeImage(source)).rejects.toThrow();
});

it('reports unavailable browser clipboard access without invoking a remote command', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.stubGlobal('ClipboardItem', undefined);
  await expect(copyLoungeImage(source)).rejects.toThrow('clipboard-unavailable');
  expect(invoke).not.toHaveBeenCalled();
});

it('starts writing during the click before asynchronous image preparation completes', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  let finish: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  class Item {
    constructor(readonly formats: Record<string, Promise<Blob>>) {}
  }
  const write = vi.fn(async (items: Item[]) => { await items[0].formats['image/png']; });
  vi.stubGlobal('ClipboardItem', Item);
  vi.stubGlobal('navigator', { clipboard: { write } });
  const copying = copyLoungeImage(source);
  expect(write).toHaveBeenCalledTimes(1);
  const blob = new Blob(['image'], { type: 'image/png' });
  finish({ ok: true, blob: async () => blob } as Response);
  await copying;
  await expect(write.mock.calls[0][0][0].formats['image/png']).resolves.toBe(blob);
});
