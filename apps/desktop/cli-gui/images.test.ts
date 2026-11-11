import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type { PaseoClient } from '@getpaseo/client';
import type { CliHistory, ExternalEngine } from '../../../shared/cli-gui/types';
import { CliService } from './service';
import { cliImages, CliImages } from './images';
import { cliThread } from '../../../shared/cli-gui/presentation';
import { MAX_CHAT_IMAGE_CHARS } from '../../../shared/remote-chat/attachments';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    expect(relative(tmpdir(), directory)).toMatch(/^remoteai-image-test-[^\\/]+$/);
    await rm(directory, { recursive: true, force: true });
  }
});
async function fixture(engine: ExternalEngine) {
  const root = await mkdtemp(join(tmpdir(), 'remoteai-image-test-')); directories.push(root);
  const current = { id: 'agent', provider: engine, model: 'native', cwd: root, updatedAt: new Date().toISOString(),
    labels: { remoteai: 'cli-gui', remoteaiClaudeAccount: 'account' }, status: 'idle', pendingPermissions: [] };
  const subscription = Object.assign(vi.fn(), { ready: Promise.resolve() });
  let sent = false;
  let replay = false;
  const agent = { id: current.id, current: () => current, refresh: async () => ({ agent: current }),
    status: 'idle', pendingPermissions: [], send: vi.fn(async () => { sent = true; }),
    timeline: { subscribe: () => subscription,
      refetch: async () => ({ agent: current, entries: sent ? [{ seqStart: 1, seqEnd: 1,
        item: { type: 'user_message', text: '[Image]',
          ...(replay ? {} : { clientMessageId: 'image-message' }) } }] : [], hasOlder: false }) } };
  const runtime = { root, connect: async () => ({ agents: { ref: () => agent } }) as unknown as PaseoClient,
    status: async () => ({ status: 'ready' as const, version: 'test' }), install() {}, close: async () => {},
    accountBridge: async () => { throw new Error('Unexpected bridge request'); } };
  return { root, agent, replay: () => { replay = true; }, service: () => new CliService(runtime, () => {}) };
}

it.each(['claude', 'gemini'] as const)('%s sends real image blocks and restores image-only history after restart',
  async engine => {
    const setup = await fixture(engine);
    await setup.service().request({ engine, action: 'send', id: 'agent', messageId: 'image-message', text: '', images: [png] });
    const nativeText = engine === 'claude' ? '[image]' : '';
    expect(setup.agent.send).toHaveBeenCalledExactlyOnceWith(nativeText, { messageId: 'image-message',
      images: [{ mimeType: 'image/png', data: png.split(',')[1] }] });
    setup.replay();
    const history = await setup.service().request({ engine, action: 'read', id: 'agent' }) as CliHistory;
    const source = history.entries[0].images![0];
    expect(source).toMatch(/^chat-image:\/\/[a-f0-9]{64}$/);
    expect(history.entries[0].text).toBe('');
    expect(cliThread(history)?.turns?.[0].items[0].content).toContainEqual({ type: 'image', url: source });
    expect(await setup.service().request({ engine, action: 'image', id: 'agent', source })).toBe(png);
    await expect(new CliImages(setup.root).load('other-session', source)).rejects.toThrow();
    await expect(setup.service().request({ engine, action: 'image', id: 'agent', source: '../secrets.png' }))
      .rejects.toThrow('invalidRequest');
  });

it('rejects invalid MIME, base64, counts and payload shapes before sending', async () => {
  for (const images of [null, 'invalid', [png.replace('image/png', 'image/svg+xml')],
    [png.replace('iVBOR', '@VBOR')], [png + 'x'], Array(9).fill(png),
    ['data:image/png;base64,' + 'A'.repeat(MAX_CHAT_IMAGE_CHARS)]]) {
    expect(() => cliImages(images)).toThrow('invalidRequest');
  }
  const setup = await fixture('claude');
  await expect(setup.service().request({ engine: 'claude', action: 'send', id: 'agent',
    messageId: 'image-message', text: '', images: [] })).rejects.toThrow('invalidRequest');
  expect(setup.agent.send).not.toHaveBeenCalled();
});
