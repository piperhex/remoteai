import { describe, expect, it, vi } from 'vitest';
import type { BrowserClient } from '../../../../shared/browser/automation';
import { uploadExtension, type ExtensionFile } from '../../../../shared/browser/extensions/transfer';

function fixture() {
  const request = vi.fn<BrowserClient['request']>().mockImplementation(async input => {
    if (input.command.action !== 'extensions') throw new Error('Unexpected command');
    return input.command.request.action === 'beginUpload' ? { transfer: { token: 'upload' } } : { entries: [] };
  });
  const client: BrowserClient = { native: false, request, subscribe: async () => () => {} };
  const file: ExtensionFile = { path: 'folder/content.js', size: 400_000, read: vi.fn(async () => 'YWJj') };
  const actions = () => request.mock.calls.map(([input]) => {
    if (input.command.action !== 'extensions') throw new Error('Unexpected command');
    return input.command.request;
  });
  return { client, file, actions };
}

describe('extension uploads', () => {
  it('sends bounded chunks with offsets and completes before releasing the transfer', async () => {
    const { client, file, actions } = fixture();
    const progress = vi.fn();
    await uploadExtension({ client, files: [file], current: () => true, progress });
    expect(actions().map(action => action.action)).toEqual([
      'beginUpload', 'writeUpload', 'writeUpload', 'writeUpload', 'finishUpload', 'releaseTransfer',
    ]);
    expect(actions().filter(action => action.action === 'writeUpload').map(action => action.offset))
      .toEqual([0, 196_608, 393_216]);
    expect(progress).toHaveBeenLastCalledWith(100);
  });
  it('never installs after the connected computer changes and still releases the upload', async () => {
    const { client, file, actions } = fixture();
    await expect(uploadExtension({ client, files: [file], current: () => false, progress: () => {} })).rejects.toThrow();
    expect(actions().map(action => action.action)).toEqual(['beginUpload', 'releaseTransfer']);
    expect(file.read).not.toHaveBeenCalled();
  });
  it('cleans up a partial upload when a source read fails', async () => {
    const { client, file, actions } = fixture();
    file.read = async () => { throw new Error('Source disappeared'); };
    await expect(uploadExtension({ client, files: [file], current: () => true, progress: () => {} })).rejects.toThrow();
    expect(actions().map(action => action.action)).toEqual(['beginUpload', 'releaseTransfer']);
  });
});
