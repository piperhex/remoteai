import { expect, it, vi } from 'vitest';
import { remoteStatusPage } from '../../../../shared/codex-status/remoteStatusPage';
import type { BrowserClient, BrowserReply } from '../../../../shared/browser/automation';

it('closes a late-opening remote browser and never captures after closing', async () => {
  let opened!: (value: BrowserReply) => void;
  const request = vi.fn<BrowserClient['request']>()
    .mockImplementationOnce(() => new Promise(resolve => { opened = resolve; }))
    .mockResolvedValue({});
  const client: BrowserClient = { native: false, request, subscribe: async () => () => {} };
  const page = remoteStatusPage(client, 'preview', 'https://status.openai.com/');
  const closing = page.close();
  await page.read();
  expect(request).toHaveBeenCalledTimes(1);
  opened({ tab: { id: 'host-tab', threadId: 'codex-status-preview', url: 'https://status.openai.com/', title: '' } });
  await closing;
  expect(request).toHaveBeenLastCalledWith({ threadId: 'codex-status-preview', tabId: 'host-tab',
    command: { action: 'close' } });
});

it('serializes browser commands and recovers after a failed screenshot', async () => {
  const request = vi.fn<BrowserClient['request']>().mockResolvedValueOnce({ tab: {
    id: 'host-tab', threadId: 'codex-status-preview', url: 'https://status.openai.com/', title: '',
  } }).mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ result: { title: 'OpenAI Status' } });
  const client: BrowserClient = { native: false, request, subscribe: async () => () => {} };
  const page = remoteStatusPage(client, 'preview', 'https://status.openai.com/');
  await expect(page.command({ action: 'screenshot' })).rejects.toThrow('temporary');
  expect((await page.read()).title).toBe('OpenAI Status');
  await page.close();
  expect(request.mock.calls.map(([input]) => input.command.action))
    .toEqual(['open', 'screenshot', 'snapshot', 'screenshot', 'close']);
});
