// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopClipboard } from '../../../../shared/remote-desktop/views/useDesktopClipboard';

const offer = { id: '12345678-1234-1234-1234-123456789abc', files: [{ name: 'remote.txt', size: 3 }] };
afterEach(() => vi.unstubAllGlobals());

it('copies remote metadata, defers bytes until local paste, and keeps serving while minimized', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const bridge = { read: vi.fn().mockResolvedValue({ format: 'text', text: '' }), chunk: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
  const local = { files: true, read: vi.fn(), write: vi.fn(), createFileSession: () => bridge };
  const remote = { fileStreaming: true, registerFiles: vi.fn(), readFile: vi.fn().mockResolvedValue('YWJj'),
    read: vi.fn(), write: vi.fn(), paste: vi.fn(), copy: vi.fn().mockResolvedValue({ format: 'fileOffer', offer }) };
  let state: ReturnType<typeof useDesktopClipboard>;
  function Harness({ active = true, connected = true }) {
    state = useDesktopClipboard({ active, connected, clipboard: remote, localClipboard: local }); return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    act(() => root.render(<Harness />));
    await act(async () => state.copy('copy'));
    expect(remote.copy).toHaveBeenCalledWith('copy', expect.any(Function), true);
    expect(bridge.publish).toHaveBeenCalledWith(offer, expect.any(Function));
    expect(remote.readFile).not.toHaveBeenCalled(); expect(local.write).not.toHaveBeenCalled();
    bridge.read.mockResolvedValue({ format: 'fileOffer', offer });
    await act(async () => state.pasteShortcut!());
    expect(remote.registerFiles).not.toHaveBeenCalled();
    act(() => root.render(<Harness active={false} />));
    expect(bridge.close).not.toHaveBeenCalled();
    const read = bridge.publish.mock.calls[0][1];
    const request = { offerId: offer.id, index: 0, offset: 0, length: 3 };
    expect(await read(request)).toBe('YWJj'); expect(remote.readFile).toHaveBeenCalledWith(request);
    act(() => root.render(<Harness active={false} connected={false} />));
    expect(bridge.close).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); }
});
