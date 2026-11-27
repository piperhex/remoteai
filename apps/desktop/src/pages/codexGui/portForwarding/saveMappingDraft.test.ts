import { expect, it, vi } from 'vitest';
import { LocalMappingAliases } from '../../../../../../shared/port-mapping/localAliases';
import { PortForwardingService } from './service';
import { saveMappingDraft } from './saveMappingDraft';

const target = { remoteHost: '127.0.0.1', remotePort: 80, localPort: 8080, protocol: 'tcp', localDomain: '' } as const;

function editor() {
  const setItem = vi.fn();
  const aliases = new LocalMappingAliases({ getItem: () => null, setItem }, 'office');
  const service = new PortForwardingService({ openResource: vi.fn(), closeResource: vi.fn(), link: vi.fn() });
  return { aliases, service, setItem };
}

it('leaves no mapping behind when a new alias cannot be stored, so saving can be retried', async () => {
  const model = editor();
  model.setItem.mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
  await expect(saveMappingDraft(model, target, 'API')).rejects.toThrow('client.mappingEditor.aliasSaveFailed');
  expect(model.service.snapshot()).toHaveLength(0);
  const id = await saveMappingDraft(model, target, 'API');
  expect(model.aliases.get(id)).toBe('API');
  expect(model.service.snapshot()).toHaveLength(1);
});

it('preserves the previous alias on validation errors and keeps an alias-only edit local', async () => {
  const model = editor();
  const id = await saveMappingDraft(model, target, 'API');
  const [entry] = model.service.snapshot();
  const edit = { ...model, entry };
  await expect(saveMappingDraft(edit, { ...target, remotePort: 0 }, 'New name')).rejects.toThrow();
  expect(model.aliases.get(id)).toBe('API');
  const changed = vi.fn();
  model.service.subscribeChanges(changed);
  await saveMappingDraft(edit, target, '  New name  ');
  expect(model.aliases.get(id)).toBe('New name');
  expect(changed).not.toHaveBeenCalled();
});
