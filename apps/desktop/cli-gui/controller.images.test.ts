import { expect, it, vi } from 'vitest';
import { CliController } from '../../../shared/cli-gui/controller';
import type { CliRequest, CliSession, ExternalEngine } from '../../../shared/cli-gui/types';

const image = { id: 'image-1', name: 'sample.png', url: 'data:image/png;base64,aGVsbG8=' };
function setup(engine: ExternalEngine, fail = false) {
  const session: CliSession = { id: 'created', engine, title: '', cwd: '', model: 'model',
    status: 'idle', archived: false, updatedAt: '', permissions: [] };
  const calls: CliRequest[] = [];
  const controller = new CliController({ subscribe: () => () => {}, request: async <T>(request: CliRequest) => {
    calls.push(request);
    if (request.action === 'send' && fail) throw new Error('client.cliGui.connectionFailed');
    if (request.action === 'create') return session as T;
    if (request.action === 'status') return { status: 'ready' } as T;
    if (request.action === 'list') return [] as T;
    if (request.action === 'read') return { session, entries: [], hasOlder: false } as T;
    if (request.action === 'catalog') return { status: 'ready', models: [{ id: 'model', label: 'Model' }], modes: [] } as T;
    return {} as T;
  } });
  return { controller, calls, session };
}
it.each(['claude', 'gemini'] as const)('%s accepts image-only sends and clears accepted attachments', async engine => {
  const { controller, calls } = setup(engine);
  await controller.refresh(); controller.chooseEngine(engine); await controller.loadCatalog();
  controller.editImages([image]); await controller.send();
  expect(calls).toContainEqual(expect.objectContaining({ action: 'send', text: '', images: [image.url] }));
  expect(controller.getSnapshot().images).toEqual([]);
});
it('keeps failed image drafts with the new session and isolates engines and conversations', async () => {
  const { controller, session } = setup('claude', true);
  await controller.refresh(); controller.chooseEngine('claude'); await controller.loadCatalog();
  controller.editImages([image]); await controller.send();
  expect(controller.getSnapshot().images).toEqual([image]);
  controller.newConversation(); expect(controller.getSnapshot().images).toEqual([]);
  controller.chooseEngine('gemini'); expect(controller.getSnapshot().images).toEqual([]);
  controller.open(session); expect(controller.getSnapshot().images).toEqual([image]);
  await vi.waitFor(() => expect(controller.getSnapshot().catalog?.status).toBe('ready'));
});
